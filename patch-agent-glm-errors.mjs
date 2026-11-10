import fs from 'node:fs';

let s = fs.readFileSync('src/agent.ts', 'utf8');

// 1. Add the import.
const importMarker = "    glmSupportsReasoningEffort,";
if (!s.includes(importMarker)) throw new Error('import marker not found');
s = s.replace(importMarker, importMarker + "\n    interpretGlmError,");

// 2. Wrap the GLM requestJson call so failures get a human diagnosis.
const callMarker = "            const response = await requestJson<GlmCompletionResponse>(\n                endpoint,\n                requestBody,\n                apiKey,\n            );";
if (!s.includes(callMarker)) throw new Error('request call marker not found');
const wrapped = `            let response: GlmCompletionResponse;
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
s = s.replace(callMarker, wrapped);

fs.writeFileSync('src/agent.ts', s);
console.log('patched agent.ts: imported interpretGlmError and wrapped the GLM request call');
