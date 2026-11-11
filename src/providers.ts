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
    /** Model id to send in the request body (e.g. `deepseek-v4-pro` or `glm-5.3-flash`). */
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
// `glm-5.3-flash` is the fast variant of the glm-5.3 flagship. It uses only a
// small active slice of the model (18B active of 320B total), so it returns
// quickly and is far less likely to hit the request timeout than the 743B
// `glm-5.3` flagship. We default to it so a fresh install does not hard-fail
// on a slow/cold flagship model.
export const GLM_DEFAULT_MODEL = 'glm-5.3-flash';

// The fast fallback used when the flagship glm-5.3 times out. This is the
// "substitute" model to swap in when the full-size model is unavailable or
// too slow to answer within the timeout.
export const GLM_FLASH_FALLBACK_MODEL = 'glm-5.3-flash';

// Reasoning effort for GLM 5.x reasoning models.
//
// NOTE: these models ALWAYS think and cannot be disabled. z.ai rejects a
// "none"/"off"/"disabled" reasoning value with:
//   "This model always engages in thinking and cannot be disabled; please use
//    low, high, or max"
// The only accepted values are `low`, `high`, and `max` — there is no `medium`
// and no off switch. We use `low` to keep latency reasonable by default while
// remaining valid.
export const GLM_REASONING_EFFORT = 'low' as const;

// The set of valid `reasoning_effort` values accepted by GLM 5.x reasoning
// models on z.ai. Anything outside this set is rejected by the API.
const GLM_VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set(['low', 'high', 'max']);

// Models that support the `reasoning_effort` request field on z.ai.
const GLM_REASONING_MODELS: ReadonlySet<string> = new Set([
    'glm-5',
    'glm-5.1',
    'glm-5.2',
    'glm-5.3',
    'glm-5.3-flash',
    'glm-5.3-flashx',
]);

/**
 * True when a model id belongs to the GLM / z.ai / Zhipu family rather than
 * DeepSeek. This is used to stop a GLM id (e.g. `glm-5.3`) from ever being
 * sent to DeepSeek's endpoints, which reject non-DeepSeek ids with
 * "The supported API model names are deepseek-flash, deepseek-v4-pro, but you
 * passed glm-5.3."
 */
export function isGlmModelId(modelId: string | undefined): boolean {
    const id = (modelId ?? '').trim().toLowerCase();
    if (!id) return false;
    return /^(glm|z-?ai|zhipu|chatglm)[\d-]/.test(id) || id.startsWith('glm');
}

/**
 * Normalize a user-supplied GLM model id into a value that z.ai actually
 * accepts. This handles a few real-world problems:
 *
 *  - Whitespace/casing from a hand-edited setting (lowercased).
 *  - Malformed ids that do not match the `glm-<major>[.<minor>][-<variant>]`
 *    shape are replaced with the fallback.
 *
 * Valid glm-5.x ids (including `glm-5.3` and `glm-5.3-flash`) are passed
 * through unchanged.
 */
export function normalizeGlmModel(modelId: string | undefined, fallback: string = GLM_DEFAULT_MODEL): string {
    const id = (modelId ?? '').trim().toLowerCase();
    if (!id) return fallback;

    // A valid glm-<major>.<minor>[-<variant>] token. z.ai ids are only ever
    // `glm-<major>[.<minor>]` plus an optional `-flash`/`-flashx`/`-air`/
    // `-turbo`/`-v` suffix. Anything outside this shape is treated as a typo
    // and replaced with the fallback.
    const match = /^glm-(\d+)(?:\.(\d+))?(-[a-z0-9]+)?$/.exec(id);
    if (!match) return fallback;

    const major = Number(match[1]);
    const minorRaw = match[2] ?? '';
    const variant = match[3] ?? '';

    return 'glm-' + major + (minorRaw ? '.' + minorRaw : '') + variant;
}

/**
 * Resolve the provider configuration for a given provider id and model id.
 *
 * The model id is user-configurable. When switching to GLM and no explicit
 * GLM model has been chosen yet, we fall back to a stable GLM alias. When the
 * DeepSeek provider is selected but the configured model id is actually a GLM
 * id (e.g. the user typed `glm-5.3` into the DeepSeek model setting), we fall
 * back to `deepseek-v4-pro` rather than sending a non-DeepSeek id to DeepSeek.
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

    // DeepSeek: never hand the DeepSeek API a GLM/z.ai model id. The /models
    // and /responses endpoints reject it with "The supported API model names
    // are deepseek-flash, deepseek-v4-pro, but you passed glm-5.3."
    const trimmed = (modelId ?? '').trim();
    const model = trimmed && !isGlmModelId(trimmed) ? trimmed : 'deepseek-v4-pro';
    return {
        endpoint: 'https://api.deepseek.com/responses',
        model,
        openAIStyle: false,
    };
}

/**
 * True when the given GLM model supports the `reasoning_effort` request field.
 */
export function glmSupportsReasoningEffort(modelId: string): boolean {
    return GLM_REASONING_MODELS.has(modelId.trim().toLowerCase());
}

/**
 * Resolve a safe `reasoning_effort` value for a GLM model.
 *
 * GLM 5.x reasoning models always think and only accept `low`, `high`, or
 * `max`. If the default (or a caller-supplied) effort is somehow not in that
 * set, we clamp it to `low` so the request is never rejected with
 * "This model always engages in thinking and cannot be disabled...".
 */
export function resolveGlmReasoningEffort(effort: string = GLM_REASONING_EFFORT): string {
    const value = (effort ?? '').trim().toLowerCase();
    return GLM_VALID_REASONING_EFFORTS.has(value) ? value : GLM_REASONING_EFFORT;
}

/**
 * True when the given GLM model is the flagship `glm-5.3` (the slow, 743B
 * variant that commonly triggers the request timeout). Used by the agent to
 * decide when to swap in the `-flash` substitute.
 */
export function isGlmFlagship53(modelId: string): boolean {
    return modelId.trim().toLowerCase() === 'glm-5.3';
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

/**
 * Turn a raw GLM (z.ai) API error message into a human-readable message that
 * includes an actionable diagnosis. Raw errors like
 *
 *   "The supported API model names are deepseek-flash, deepseek-v4-pro, but
 *    you passed glm-4.6."
 *
 * tell the user *what* failed but not *why* or *what to do*. This helper
 * recognizes the failure shapes z.ai actually returns and appends a concrete
 * next step.
 */
export function interpretGlmError(message: string): string {
    const raw = (message ?? '').trim();
    if (!raw) return 'GLM request failed: the service returned an empty error message.';

    const lower = raw.toLowerCase();

    // Key/plan mismatch, e.g. a z.ai key that only has DeepSeek model access
    // while the extension asked for a GLM model.
    const supported = /supported\s+api\s+model\s+names?\s+are\s+(.+?),\s*but\s+you\s+passed\s+(\S+)/i.exec(raw);
    if (supported) {
        const models = supported[1].trim().replace(/\s+/g, ' ');
        const requested = supported[2].replace(/[.,]$/, '');
        const isDeepSeekOnly = /deepseek/i.test(models) && !/glm/i.test(models);
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the configured GLM API key is not authorized for the model "' + requested + '".',
            'This key only supports: ' + models + '.' + (isDeepSeekOnly
                ? ' It looks like a DeepSeek-only z.ai key rather than a GLM key.'
                : ''),
            '',
            'Fix: run the command "Coding Agent: Set GLM API Key" and paste a z.ai API key that has GLM model access,',
            'or switch the model via the "codingAgent.glmModel" setting to one of the supported ids listed above.',
        ].join('\n');
    }

    // Authentication failures.
    if (lower.includes('authorization') || lower.includes('invalid api key') || lower.includes('unauthorized') || lower.includes('401')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the stored GLM API key was rejected.',
            'Fix: run the command "Coding Agent: Set GLM API Key" and re-enter a valid z.ai API key.',
        ].join('\n');
    }

    // Unknown / misspelled model id.
    if (lower.includes('model does not exist') || lower.includes('model not found') || lower.includes('no such model')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the configured GLM model id is not valid on z.ai.',
            'Fix: set "codingAgent.glmModel" to a valid id such as glm-4.6, glm-5.3, or glm-5.3-flash, then reload the window.',
        ].join('\n');
    }

    // Billing / quota.
    if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('balance') || lower.includes('arrears')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the z.ai account has run out of quota or balance for this model.',
            'Fix: top up the account or switch to a cheaper model (e.g. glm-5.3-flash) via the "codingAgent.glmModel" setting.',
        ].join('\n');
    }

    if (lower.includes('timed out')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: z.ai did not respond within the timeout.',
            'Fix: retry the request. If it keeps timing out, use a faster model (e.g. glm-5.3-flash), which the agent will now attempt automatically.',
        ].join('\n');
    }

    // GLM 5.x reasoning models always think and reject an invalid/off
    // `reasoning_effort` value. Catch this specific shape and give a clear fix.
    if (lower.includes('cannot be disabled') || (lower.includes('thinking') && lower.includes('low'))) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: this model always engages in reasoning (thinking) and rejects a disabled or invalid reasoning_effort value.',
            'Fix: use reasoning_effort "low", "high", or "max" (not "none", "off", or "medium"). This is now handled automatically.',
        ].join('\n');
    }

    // Anything else: still tag it so the error source classifier and the user
    // can tell it came from the GLM provider.
    return 'GLM request failed: ' + raw;
}

export const GLM_TOOL_DEFINITIONS: GlmToolDefinition[] = toGlmTools([
    {
        type: 'function',
        name: 'search_searxng',
        description: 'Search a local SearXNG metasearch instance by query. Use this only when the user explicitly asks to search SearXNG; otherwise use the default DeepSeek web_search instead.',
        parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query to run against SearXNG.' } },
            required: ['query'],
            additionalProperties: false,
        },
    },
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
