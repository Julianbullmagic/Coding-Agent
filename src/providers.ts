/**
 * Provider abstraction for DeepSeek and GLM (Zhipu AI / Z.AI).
 *
 * DeepSeek uses the "Responses API" (`/responses`) with `function_call`
 * items, web-search items, and `instructions`. GLM (Zhipu AI / Z.AI)
 * exposes an OpenAI-compatible Chat Completions API (`/chat/completions`)
 * that uses the standard `tools` / `tool_calls` format.
 *
 * GLM is routed to the international Z.AI endpoint (`https://api.z.ai`),
 * which serves the glm-4.x model family. The mainland China endpoint
 * (`https://open.bigmodel.cn`) uses a different model id space.
 *
 * Rather than forcing both providers through a single request shape, this
 * module exposes small helpers that the agent uses to (a) pick the right
 * endpoint, (b) build the right request body, and (c) parse the provider
 * specific response format back into a normalized shape the agent loop
 * already understands.
 */

export type Provider = 'deepseek' | 'glm';

export interface ProviderConfig {
    /** Endpoint the agent should POST chat requests to. */
    endpoint: string;
    /** Model id to send in the request body (e.g. `deepseek-v4-pro` or `glm-4.6`). */
    model: string;
    /** True when the provider uses the Chat Completions (OpenAI) format. */
    openAIStyle: boolean;
}

// The international Z.AI endpoint. This is where a z.ai / Zhipu international
// account's API key is valid. The mainland China endpoint differs (rather than
// `open.bigmodel.cn/api/paas/v4/...`), so keep this aligned with the account
// the user actually holds.
export const GLM_DEFAULT_MODEL = 'glm-4.6';

/**
 * Resolve the provider configuration for a given provider id and model id.
 *
 * The model id is user-configurable. When switching to GLM and no explicit
 * GLM model has been chosen yet, we fall back to a stable GLM alias.
 */
export function resolveProvider(provider: Provider, modelId?: string): ProviderConfig {
    if (provider === 'glm') {
        return {
            endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
            model: (modelId && modelId.trim()) || GLM_DEFAULT_MODEL,
            openAIStyle: true,
        };
    }
    return {
        endpoint: 'https://api.deepseek.com/responses',
        model: (modelId && modelId.trim()) || 'deepseek-v4-pro',
        openAIStyle: false,
    };
}

export const GLM_MODEL_KEY = 'codingAgent.glmModel';
export const GLM_API_KEY_SECRET = 'codingAgent.glmApiKey';
export const PROVIDER_KEY = 'codingAgent.provider';

export interface GlmToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface GlmToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

export interface GlmCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string | null;
            // GLM reasoning models can return the final answer in this field
            // instead of `content` (especially when `reasoning_effort` is set).
            reasoning_content?: string | null;
            tool_calls?: GlmToolCall[];
        };
    }>;
    error?: { message?: string };
}

/**
 * Extract the visible text from a GLM choice message, accounting for the fact
 * that reasoning models may put the answer in `reasoning_content` rather than
 * `content`.
 */
export function extractGlmText(message: { content?: string | null; reasoning_content?: string | null } | undefined): string {
    if (!message) return '';
    return ((message.content ?? '') || (message.reasoning_content ?? '')).trim();
}

/**
 * Convert the agent's unified tool definitions (the DeepSeek `TOOLS` array)
 * into OpenAI-style `tools` entries that GLM's Chat Completions API expects.
 *
 * DeepSeek's `web_search` is a native hosted tool with no OpenAI equivalent,
 * so it is skipped. All the `function` tools map directly.
 */
export function toGlmTools(tools: Array<Record<string, unknown>>): GlmToolDefinition[] {
    const result: GlmToolDefinition[] = [];
    for (const tool of tools) {
        const type = tool.type;
        if (type !== 'function') continue;
        const name = typeof tool.name === 'string' ? tool.name : '';
        const description = typeof tool.description === 'string' ? tool.description : '';
        const parameters = (tool.parameters ?? {}) as Record<string, unknown>;
        if (!name) continue;
        result.push({
            type: 'function',
            function: { name, description, parameters },
        });
    }
    return result;
}

export const GLM_TOOL_DEFINITIONS: GlmToolDefinition[] = toGlmTools([
    {
        type: 'function',
        name: 'retrieve_relevant_context',
        description: 'Retrieve relevant context from earlier conversations in this workspace. Use this when the user refers back to something previously discussed or explicitly asks you to recall prior information.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'A concise description of what prior context to recall.' } },
            required: ['query'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'fetch_page',
        description: 'Fetch a public web page URL and return its text as Markdown.',
        parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'An HTTP or HTTPS page URL.' } },
            required: ['url'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'list_files',
        description: 'List files and directories in a workspace-relative path.',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative directory, or empty for the workspace root.' } }, required: [], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'read_file',
        description: 'Read a text file inside the opened workspace.',
        parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path.' } }, required: ['path'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'write_file',
        description: 'Create or replace a text file inside the opened workspace, creating parent directories as needed.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'create_directory',
        description: 'Create a directory inside the opened workspace.',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'run_command',
        description: 'Run a shell command in the opened workspace (cmd.exe on Windows, /bin/sh otherwise) to install dependencies, build, run tests, or start software.',
        parameters: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                timeoutMs: { type: 'number' },
            },
            required: ['command'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'sign_in_to_github',
        description: 'Start GitHub CLI device/web authentication, then configure Git HTTPS credentials and local workspace Git identity.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'create_github_repository',
        description: 'Initialize the workspace as a Git repository and create and push it to GitHub using the GitHub CLI.',
        parameters: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                visibility: { type: 'string', enum: ['public', 'private'] },
                description: { type: 'string' },
            },
            required: ['name', 'visibility'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'commit_and_push',
        description: 'Stage all workspace changes, create a Git commit, and push it to the configured remote branch.',
        parameters: {
            type: 'object',
            properties: {
                message: { type: 'string' },
                remote: { type: 'string' },
                branch: { type: 'string' },
            },
            required: ['message'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'list_calendar_events',
        description: 'List upcoming events from the user\'s primary Google Calendar. Read-only.',
        parameters: {
            type: 'object',
            properties: { timeMin: { type: 'string' }, timeMax: { type: 'string' }, maxResults: { type: 'number' } },
            required: [],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'create_calendar_event',
        description: 'Create a new Google Calendar event. Requires user confirmation before executing.',
        parameters: {
            type: 'object',
            properties: { summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' } },
            required: ['summary', 'start', 'end'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'update_calendar_event',
        description: 'Update an existing Google Calendar event. Requires user confirmation before executing.',
        parameters: {
            type: 'object',
            properties: { eventId: { type: 'string' }, summary: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' }, location: { type: 'string' } },
            required: ['eventId'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'delete_calendar_event',
        description: 'Delete a Google Calendar event. Requires user confirmation before executing.',
        parameters: { type: 'object', properties: { eventId: { type: 'string' } }, required: ['eventId'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'list_emails',
        description: 'List recent Gmail messages. Read-only.',
        parameters: { type: 'object', properties: { maxResults: { type: 'number' }, query: { type: 'string' } }, required: [], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'search_emails',
        description: 'Search Gmail messages using a Gmail query. Read-only.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'read_email',
        description: 'Read a single Gmail message by ID. Read-only.',
        parameters: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'], additionalProperties: false },
    },
    {
        type: 'function',
        name: 'send_email',
        description: 'Send a new Gmail message. Requires user confirmation before executing.',
        parameters: {
            type: 'object',
            properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, cc: { type: 'string' }, bcc: { type: 'string' } },
            required: ['to', 'subject', 'body'],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'reply_email',
        description: 'Reply to an existing Gmail message by ID. Requires user confirmation before executing.',
        parameters: { type: 'object', properties: { messageId: { type: 'string' }, body: { type: 'string' } }, required: ['messageId', 'body'], additionalProperties: false },
    },
]);
