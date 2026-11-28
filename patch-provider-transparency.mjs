// Fix provider transparency:
// 1. Store the provider selection in GLOBAL state (workspaceState silently
//    reset it to deepseek whenever a different folder was opened).
// 2. When a provider request fails, name the provider in the chat message and
//    tell the user they can click the other model button to switch and resend.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/extension.ts';
let s = readFileSync(file, 'utf8');

// --- 1. Global provider state -------------------------------------------------

const oldCurrent = `    private currentProvider(): Provider {
        const stored = this.context.workspaceState.get<string>(PROVIDER_KEY);
        return stored === 'glm' ? 'glm' : 'deepseek';
    }`;
const newCurrent = `    private currentProvider(): Provider {
        // Stored in GLOBAL state (not workspaceState) so the chosen provider
        // survives opening a different folder. It previously lived in
        // workspaceState, which silently reset to deepseek on folder switches.
        const stored = this.context.globalState.get<string>(PROVIDER_KEY);
        return stored === 'glm' ? 'glm' : 'deepseek';
    }`;
if (!s.includes(oldCurrent)) throw new Error('currentProvider block not found');
s = s.replace(oldCurrent, newCurrent);

const oldSet = `        await this.context.workspaceState.update(PROVIDER_KEY, normalized);`;
const newSet = `        await this.context.globalState.update(PROVIDER_KEY, normalized);`;
if (!s.includes(oldSet)) throw new Error('setProvider update not found');
s = s.replace(oldSet, newSet);

const oldActivate = `                const activeProvider = context.workspaceState.get<string>(PROVIDER_KEY);`;
const newActivate = `                const activeProvider = context.globalState.get<string>(PROVIDER_KEY);`;
if (!s.includes(oldActivate)) throw new Error('activate provider read not found');
s = s.replace(oldActivate, newActivate);

// --- 2. Provider-aware failure messages ---------------------------------------

const oldCatch = `            const source = classifySource(error);
            await recordError(this.context, source, error);
            await this.save(conv.id, [...messages, { role: 'assistant', content: \`Request failed: \${detail}\` }]);`;
const newCatch = `            const source = classifySource(error);
            await recordError(this.context, source, error);
            const other = provider === 'glm' ? 'DeepSeek' : 'GLM';
            const hint = provider === 'glm'
                ? \`\\n\\nThis was a GLM (z.ai) request failure — no GLM tokens were consumed. You can click the DeepSeek button at the top of the chat to switch providers and resend.\`
                : \`\\n\\nThis was a DeepSeek request failure. You can click the GLM button at the top of the chat to switch providers and resend.\`;
            await this.save(conv.id, [...messages, { role: 'assistant', content: \`[\${provider.toUpperCase()}] Request failed: \${detail}\${hint}\` }]);`;
if (!s.includes(oldCatch)) throw new Error('catch block not found');
s = s.replace(oldCatch, newCatch);

writeFileSync(file, s, 'utf8');
console.log('patched extension.ts successfully');
