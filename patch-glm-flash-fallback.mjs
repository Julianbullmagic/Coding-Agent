// Patch agent.ts to add automatic glm-5.3 -> glm-5.3-flash fallback on timeout,
// plus a single retry for transient timeouts.
import { readFileSync, writeFileSync } from 'fs';

const file = 'src/agent.ts';
let s = readFileSync(file, 'utf8');

// 1. Extend the providers import with the new symbols.
const importOld = "    interpretGlmError,\n    GLM_DEFAULT_MODEL,\n} from './providers';";
const importNew = "    interpretGlmError,\n    GLM_DEFAULT_MODEL,\n    GLM_FLASH_FALLBACK_MODEL,\n    isGlmFlagship53,\n} from './providers';";
if (!s.includes(importOld)) {
    throw new Error('import block not found');
}
s = s.replace(importOld, importNew);

// 2. Replace the resolveProvider('glm', ...) call so we get the raw model id
//    for fallback decisions (we still use cfg.model for the actual request).
const resolveOld = "        const cfg = resolveProvider('glm', this.glmModelId);";
const resolveNew = "        const cfg = resolveProvider('glm', this.glmModelId);\n        // The model id actually being requested this turn. If it is the\n        // flagship glm-5.3 and the request times out, we swap in the fast\n        // glm-5.3-flash substitute on the next attempt.\n        let activeModel = cfg.model;";
if (!s.includes(resolveOld)) {
    throw new Error('resolveProvider call not found');
}
s = s.replace(resolveOld, resolveNew);

// 3. Replace the GLM request try/catch inside the loop with a version that
//    (a) uses activeModel, (b) retries once, and (c) falls back to flash.
const requestOld = `            const glmBody: Record<string, unknown> = {
                model: cfg.model,
                messages,
                max_tokens: 8192,
                tools: GLM_TOOL_DEFINITIONS,
                tool_choice: 'auto',
            };
            if (glmSupportsReasoningEffort(cfg.model)) {
                glmBody.reasoning_effort = GLM_REASONING_EFFORT;
            }
            const requestBody: string = JSON.stringify(glmBody);
            let response: GlmCompletionResponse;
            try {
                response = await requestJson<GlmCompletionResponse>(
                    endpoint,
                    requestBody,
                    apiKey,
                );
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new Error(interpretGlmError(detail));
            }`;

const requestNew = `            let response: GlmCompletionResponse;
            let attempts = 0;
            // Allow one retry, and allow a fallback from the slow flagship
            // glm-5.3 to the fast glm-5.3-flash when the request times out.
            while (true) {
                const glmBody: Record<string, unknown> = {
                    model: activeModel,
                    messages,
                    max_tokens: 8192,
                    tools: GLM_TOOL_DEFINITIONS,
                    tool_choice: 'auto',
                };
                if (glmSupportsReasoningEffort(activeModel)) {
                    glmBody.reasoning_effort = GLM_REASONING_EFFORT;
                }
                const requestBody: string = JSON.stringify(glmBody);
                try {
                    response = await requestJson<GlmCompletionResponse>(
                        endpoint,
                        requestBody,
                        apiKey,
                    );
                    break;
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    // Only timeouts are worth retrying/fallback; hard errors
                    // (auth, quota, unknown model) should surface immediately.
                    const isTimeout = /timed out|timeout/i.test(detail);
                    if (isTimeout && isGlmFlagship53(activeModel)) {
                        activeModel = GLM_FLASH_FALLBACK_MODEL;
                        continue;
                    }
                    if (isTimeout) {
                        attempts += 1;
                        if (attempts < 2) continue;
                    }
                    throw new Error(interpretGlmError(detail));
                }
            }`;

if (!s.includes(requestOld)) {
    throw new Error('GLM request block not found');
}
s = s.replace(requestOld, requestNew);

writeFileSync(file, s, 'utf8');
console.log('patched agent.ts successfully');
