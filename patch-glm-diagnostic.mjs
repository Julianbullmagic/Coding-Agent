import fs from 'node:fs';

const s = fs.readFileSync('src/providers.ts', 'utf8');

const marker = "export const GLM_TOOL_DEFINITIONS";
const idx = s.indexOf(marker);
if (idx < 0) throw new Error('marker not found');

const addition = `/**
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
    const supported = /supported\\s+api\\s+model\\s+names?\\s+are\\s+(.+?),\\s*but\\s+you\\s+passed\\s+(\\S+)/i.exec(raw);
    if (supported) {
        const models = supported[1].trim().replace(/\\s+/g, ' ');
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
        ].join('\\n');
    }

    // Authentication failures.
    if (lower.includes('authorization') || lower.includes('invalid api key') || lower.includes('unauthorized') || lower.includes('401')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the stored GLM API key was rejected.',
            'Fix: run the command "Coding Agent: Set GLM API Key" and re-enter a valid z.ai API key.',
        ].join('\\n');
    }

    // Unknown / misspelled model id.
    if (lower.includes('model does not exist') || lower.includes('model not found') || lower.includes('no such model')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the configured GLM model id is not valid on z.ai.',
            'Fix: set "codingAgent.glmModel" to a valid id such as glm-4.6, glm-4.7, or glm-5, then reload the window.',
        ].join('\\n');
    }

    // Billing / quota.
    if (lower.includes('quota') || lower.includes('insufficient') || lower.includes('balance') || lower.includes('arrears')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: the z.ai account has run out of quota or balance for this model.',
            'Fix: top up the account or switch to a cheaper model (e.g. glm-4.6) via the "codingAgent.glmModel" setting.',
        ].join('\\n');
    }

    if (lower.includes('timed out')) {
        return [
            'GLM request failed: ' + raw,
            '',
            'Diagnosis: z.ai did not respond within the timeout.',
            'Fix: retry the request. If it keeps timing out, try a smaller prompt or a faster model (e.g. glm-4.6).',
        ].join('\\n');
    }

    // Anything else: still tag it so the error source classifier and the user
    // can tell it came from the GLM provider.
    return 'GLM request failed: ' + raw;
}

`;

fs.writeFileSync('src/providers.ts', s.slice(0, idx) + addition + s.slice(idx));
console.log('patched providers.ts, added interpretGlmError before GLM_TOOL_DEFINITIONS');
