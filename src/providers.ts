/**
 * Provider abstraction for DeepSeek and GLM (Zhipu AI / Z.AI).
 *
 * DeepSeek uses the "Responses API" (`/responses`) with `function_call`
 * items, web-search items, and `instructions`. GLM (Zhipu AI / Z.AI)
 * exposes an OpenAI-compatible Chat Completions API (`/chat/completions`)
 * that uses the standard `tools` / `tool_calls` format.
 *
 * GLM is routed to the international Z.AI endpoint (`https://api.z.ai`),
 * which serves the glm-4.x / glm-5.x model families. The mainland China
 * endpoint (`https://open.bigmodel.cn`) uses a different model id space.
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
export const GLM_API_ENDPOINT = 'https://api.z.ai/api/paas/v4/chat/completions';

// The default GLM model for the z.ai international platform.
//
// NOTE: z.ai serves the GLM model family under ids such as `glm-4.5`,
// `glm-4.6`, `glm-4.7`, `glm-5`, `glm-5.1`, `glm-5.2`, and their `flash`
// variants. There is no `glm-5.3` id on z.ai; the flagship 5.x models are
// simply named `glm-5`, `glm-5.1`, etc. `glm-4.6` is a reliable general
// purpose default that works without a coding-plan subscription.
export const GLM_DEFAULT_MODEL = 'glm-4.6';

// Reasoning effort for GLM 5.x reasoning models (low/medium/high/max).
// `glm-4.6` and other non-reasoning models ignore or reject this field, so
// it is only attached when the selected model is a reasoning variant.
export const GLM_REASONING_EFFORT = 'medium' as const;

// Models that support the `reasoning_effort` request field on z.ai.
const GLM_REASONING_MODELS: ReadonlySet<string> = new Set(['glm-5', 'glm-5.1', 'glm-5.2']);

/**
 * Normalize a user-supplied GLM model id into a value that z.ai actually
 * accepts. This handles a few real-world problems:
 *
 *  - Tentative/pinned ids that never existed on z.ai (e.g. `glm-5.3`).
 *  - Whitespace/casing from a hand-edited setting.
 *
 * If the id is not recognized at all, fall back to the given default so the
 * request does not hard-fail on a typo.
 */
export function normalizeGlmModel(modelId: string | undefined, fallback: string = GLM_DEFAULT_MODEL): string {
    const id = (modelId ?? '').trim().toLowerCase();
    if (!id) return fallback;

    // A valid glm-<major>.<minor>[-<variant>] token. z.ai ids are only ever
    // `glm-<major>[.<minor>]` plus an optional `-flash`/`-air`/`-turbo`/`-v`
    // suffix. Anything outside this shape is treated as a typo and replaced.
    const match = /^glm-(\d+)(?:\.(\d+))?(-[a-z0-9]+)?$/.exec(id);
    if (!match) return fallback;

    const major = Number(match[1]);
    const minorRaw = match[2] ?? '';
    const variant = match[3] ?? '';

    // The 5.x flagship reasoning models on z.ai are named `glm-5`, `glm-5.1`,
    // `glm-5.2`, etc. There is no `glm-5.3`. Remap any invented 5.x minor
    // (5.3 and beyond) down to the known flagship `glm-5` so a stale setting
    // doesn't hard-fail.
    if (major >= 5 && minorRaw && Number(minorRaw) >= 3) {
        return 'glm-5' + variant;
    }

    // Everything else is returned normalized to lowercase (e.g. `glm-4.6`,
    // `glm-4.7-flash`).
    return 'glm-' + major + (minorRaw ? '.' + minorRaw : '') + variant;
}

/**
 * Resolve the provider configuration for a given provider id and model id.
 *
 * The model id is user-configurable. When switching to GLM and no explicit
 * GLM model has been chosen yet, we fall back to a stable GLM alias.
 */
export function resolveProvider(provider: Provider, modelId?: string): ProviderConfig {
    if (provider === 'glm') {
        const model = normalizeGlmModel(modelId);
        return {
            endpoint: GLM_API_ENDPOINT,
            model,
            openAIStyle: true,
        };
    }
    return {
        endpoint: 'https://api.deepseek.com/responses',
        model: (modelId && modelId.trim()) || 'deepseek-v4-pro',
        openAIStyle: false,
    };
}

/**
 * True when the given GLM model supports the `reasoning_effort` request field.
 */
export function glmSupportsReasoningEffort(modelId: string): boolean {
    return GLM_REASONING_MODELS.has(modelId.trim().toLowerCase());
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
