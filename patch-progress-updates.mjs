// Adds periodic progress updates from the agent loop to the webview UI.
// - agent.ts: progress handler + emitProgress calls in both the DeepSeek and
//   GLM tool loops.
// - extension.ts: forwards progress messages to the webview while a prompt
//   is being processed.
// - webview HTML/JS: renders a live status line above the composer.
import { readFileSync, writeFileSync } from 'fs';

function patch(file, replacements) {
    let text = readFileSync(file, 'utf8');
    for (const [find, replace, label] of replacements) {
        if (!text.includes(find)) {
            throw new Error(`PATCH FAILED (${file}): ${label ?? 'anchor not found'}`);
        }
        if (text.split(find).length - 1 !== 1) {
            throw new Error(`PATCH FAILED (${file}): ${label ?? 'anchor'} is not unique`);
        }
        text = text.replace(find, replace);
    }
    writeFileSync(file, text);
    console.log(`Patched ${file}`);
}

// ----------------------------- agent.ts -----------------------------------
patch('src/agent.ts', [
    // 1. Progress handler API on the CodingAgent class.
    [
        `    getModel(provider: Provider = 'deepseek'): string {
        return provider === 'glm' ? this.glmModelId : this.deepseekModelId;
    }
`,
        `    getModel(provider: Provider = 'deepseek'): string {
        return provider === 'glm' ? this.glmModelId : this.deepseekModelId;
    }

    // Optional callback invoked with short human-readable status lines while
    // the agent loop runs (thinking, running tools). The UI forwards these to
    // the user so long turns do not look stuck.
    setProgressHandler(handler: ((message: string) => void) | undefined): void {
        this.progressHandler = handler;
    }

    private emitProgress(message: string): void {
        try {
            this.progressHandler?.(message);
        } catch {
            // Progress reporting must never break the agent loop.
        }
    }
`,
        'progress handler API',
    ],
    // 2. DeepSeek loop: announce each round.
    [
        `        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            const requestBody: string = JSON.stringify({`,
        `        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);
            const requestBody: string = JSON.stringify({`,
        'deepseek round announce',
    ],
    // 3. DeepSeek loop: announce tools about to run.
    [
        `            const webCalls: ResponseOutputItem[] = output.filter((item: ResponseOutputItem) => item.type === 'web_search_call');
`,
        `            const webCalls: ResponseOutputItem[] = output.filter((item: ResponseOutputItem) => item.type === 'web_search_call');
            const toolNames = calls.map((c) => c.name || 'unknown_tool');
            if (webCalls.length > 0) toolNames.push('web_search');
            if (toolNames.length > 0) {
                this.emitProgress(\`Step \${round + 1}: running \${toolNames.join(', ')}\`);
            }
`,
        'deepseek tool announce',
    ],
    // 4. GLM loop: announce each round.
    [
        `        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            let response: GlmCompletionResponse;`,
        `        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);
            let response: GlmCompletionResponse;`,
        'glm round announce',
    ],
    // 5. GLM loop: announce tools about to run.
    [
        `            for (const toolCall of toolCalls) {
                const toolName = toolCall.function?.name ?? '';`,
        `            if (toolCalls.length > 0) {
                this.emitProgress(\`Step \${round + 1}: running \` + toolCalls.map((c: GlmToolCall) => c.function?.name || 'unknown_tool').join(', '));
            }
            for (const toolCall of toolCalls) {
                const toolName = toolCall.function?.name ?? '';`,
        'glm tool announce',
    ],
]);

// ---------------------------- extension.ts ---------------------------------
patch('src/extension.ts', [
    // Forward progress to the webview while a queued prompt is processed.
    [
        `            const response = await this.agent.provideSuggestions(effectivePrompt, apiKey, searxngBaseUrl, history, workspacePath, maxToolRounds, provider);`,
        `            this.agent.setProgressHandler((message: string) => {
                void view.webview.postMessage({ type: 'progress', text: message });
            });
            let response: string;
            try {
                response = await this.agent.provideSuggestions(effectivePrompt, apiKey, searxngBaseUrl, history, workspacePath, maxToolRounds, provider);
            } finally {
                this.agent.setProgressHandler(undefined);
            }`,
        'forward progress to webview',
    ],
    // Webview: handle progress messages and refresh the status line on state.
    [
        `addEventListener('message',event=>{if(event.data.type!=='state')return;state=event.data;`,
        `function renderProgress(){const el=document.getElementById('progressLine');if(!el)return;if(state.processing&&state.progressText){el.style.display='block';el.textContent=state.progressText}else{el.style.display='none'}}addEventListener('message',event=>{if(event.data.type==='progress'){state.progressText=event.data.text;renderProgress();return}if(event.data.type!=='state')return;state=event.data;renderProgress();`,
        'webview progress listener',
    ],
    // Webview: status line element between messages and composer.
    [
        `<div class="messages" id="messages"></div>`,
        `<div class="messages" id="messages"></div><div class="progress" id="progressLine" style="display:none"></div>`,
        'webview progress element',
    ],
    // Webview: status line style.
    [
        `@media(max-width:280px)`,
        `.progress{display:none;padding:4px 10px;color:var(--vscode-descriptionForeground);font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:280px)`,
        'webview progress style',
    ],
]);

console.log('All patches applied.');
