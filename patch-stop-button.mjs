// Patch: make the Stop button actually interrupt the in-flight agent run.
// Previously "stop" only cleared the prompt queue; a running API call or tool
// kept going to completion. This adds AbortController-based cancellation to
// agent.ts (HTTP requests, spawned shells, tool-round loop) and wires the
// queue's stopQueue() to cancel the current run immediately.
import { readFile, writeFile } from 'fs/promises';

const patch = async (file, replacements) => {
    let source = await readFile(file, 'utf8');
    for (const [from, to] of replacements) {
        if (!source.includes(from)) {
            throw new Error(`Patch anchor not found in ${file}: ${JSON.stringify(from.slice(0, 80))}`);
        }
        source = source.replace(from, to);
    }
    await writeFile(file, source, 'utf8');
    console.log(`patched ${file}`);
};

// --- agent.ts ---------------------------------------------------------------

await patch('src/agent.ts', [
    // 1. requestJson accepts an optional abort signal.
    [
        `function requestJson<T>(url: URL, body?: string, apiKey?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const headers: http.OutgoingHttpHeaders = { Accept: 'application/json' };`,
        `function requestJson<T>(url: URL, body?: string, apiKey?: string, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('The request was cancelled.'));
            return;
        }
        const headers: http.OutgoingHttpHeaders = { Accept: 'application/json' };`,
    ],
    // 2. Wire the signal into the HTTP request lifecycle.
    [
        `        const request = url.protocol === 'https:'
            ? https.request(url, options, onResponse)
            : http.request(url, options, onResponse);
        request.setTimeout(300_000, () => request.destroy(new Error('Web request timed out.')));`,
        `        const request = url.protocol === 'https:'
            ? https.request(url, options, onResponse)
            : http.request(url, options, onResponse);
        request.setTimeout(300_000, () => request.destroy(new Error('Web request timed out.')));
        const onAbort = () => {
            request.destroy(new Error('The request was cancelled.'));
        };
        if (signal) {
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
            request.on('close', () => signal.removeEventListener('abort', onAbort));
        }`,
    ],
    // 3. Retry wrapper passes the signal through.
    [
        `async function requestJsonWithRetry<T>(
    url: URL,
    body: string | undefined,
    apiKey: string | undefined,
    maxAttempts: number = 3,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await requestJson<T>(url, body, apiKey);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const lower = message.toLowerCase();`,
        `async function requestJsonWithRetry<T>(
    url: URL,
    body: string | undefined,
    apiKey: string | undefined,
    maxAttempts: number = 3,
    signal?: AbortSignal,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (signal?.aborted) {
            throw new Error('The request was cancelled.');
        }
        try {
            return await requestJson<T>(url, body, apiKey, signal);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const lower = message.toLowerCase();
            if (signal?.aborted) {
                throw new Error('The request was cancelled.');
            }`,
    ],
    // 4. Backoff sleep inside retry should wake early on abort.
    [
        `            // Small backoff before retrying a transient failure.
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));`,
        `            // Small backoff before retrying a transient failure.
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, 500 * attempt);
                signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
            });
            if (signal?.aborted) {
                throw new Error('The request was cancelled.');
            }`,
    ],
    // 5. runShellCommand kills the child when the signal aborts.
    [
        `function runShellCommand(workspacePath: string, command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const normalized = Math.max(1000, Math.min(600000, Math.floor(timeoutMs || 120000)));`,
        `function runShellCommand(workspacePath: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('The command was cancelled.'));
            return;
        }
        const normalized = Math.max(1000, Math.min(600000, Math.floor(timeoutMs || 120000)));`,
    ],
    [
        `        const timer = setTimeout(() => { timedOut = true; child.kill(); }, normalized);`,
        `        const timer = setTimeout(() => { timedOut = true; child.kill(); }, normalized);
        const onAbort = () => { timedOut = false; child.kill(); reject(new Error('The command was cancelled.')); };
        if (signal) {
            if (signal.aborted) { onAbort(); return; }
            signal.addEventListener('abort', onAbort, { once: true });
        }`,
    ],
    [
        `        child.once('close', (code) => {
            clearTimeout(timer);
            const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\\n');
            if (timedOut) reject(new Error(\`Command timed out after \${normalized} ms.\`));
            else if (code === 0) resolve(combined || 'Command completed with no output.');
            else reject(new Error(combined || \`Command exited with code \${code ?? 'unknown'}.\`));
        });`,
        `        child.once('close', (code) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (signal?.aborted) {
                reject(new Error('The command was cancelled.'));
                return;
            }
            const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\\n');
            if (timedOut) reject(new Error(\`Command timed out after \${normalized} ms.\`));
            else if (code === 0) resolve(combined || 'Command completed with no output.');
            else reject(new Error(combined || \`Command exited with code \${code ?? 'unknown'}.\`));
        });`,
    ],
    // 6. CodingAgent: cancellation state and public API.
    [
        `export class CodingAgent {
    private progressHandler?: (message: string) => void;
    private deepseekModelId: string;
    private glmModelId: string;`,
        `export class CodingAgent {
    private progressHandler?: (message: string) => void;
    private deepseekModelId: string;
    private glmModelId: string;
    private abortController?: AbortController;

    // Cancel the in-flight run: the current HTTP request is aborted, spawned
    // shell commands are killed, and the tool loop throws at the next check.
    cancel(): void {
        this.abortController?.abort();
    }

    isCancelled(): boolean {
        return this.abortController?.signal.aborted ?? false;
    }`,
    ],
    // 7. Cancelled-error helper.
    [
        `    private emitProgress(message: string): void {`,
        `    private static isCancelledError(message: string): boolean {
        return /was cancelled|cancelled by the user|abort/i.test(message);
    }

    private emitProgress(message: string): void {`,
    ],
    // 8. executeTool accepts and forwards the signal.
    [
        `    private async executeTool(name: string, rawArgs: string, workspacePath: string, apiKey: string, provider: Provider, searxngBaseUrl: string): Promise<string> {`,
        `    private async executeTool(name: string, rawArgs: string, workspacePath: string, apiKey: string, provider: Provider, searxngBaseUrl: string, signal?: AbortSignal): Promise<string> {`,
    ],
    [
        `            } else if (name === 'run_command' && typeof args.command === 'string') {
                const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 120000;
                return await runShellCommand(workspacePath, args.command, timeoutMs);`,
        `            } else if (name === 'run_command' && typeof args.command === 'string') {
                const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 120000;
                return await runShellCommand(workspacePath, args.command, timeoutMs, signal);`,
    ],
    // 9. DeepSeek loop: create controller, check between rounds, pass signal.
    [
        `        const instructions = this.scopedInstructions(workspacePath);
        const model = resolveProvider('deepseek', this.deepseekModelId).model;

        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);`,
        `        const instructions = this.scopedInstructions(workspacePath);
        const model = resolveProvider('deepseek', this.deepseekModelId).model;
        const signal = (this.abortController = new AbortController()).signal;

        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            if (signal.aborted) throw new Error('The request was cancelled by the user.');
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);`,
    ],
    [
        `            const response: DeepSeekResponse | null = await requestJsonWithRetry<DeepSeekResponse | null>(
                new URL('https://api.deepseek.com/responses'),
                requestBody,
                apiKey,
            );`,
        `            const response: DeepSeekResponse | null = await requestJsonWithRetry<DeepSeekResponse | null>(
                new URL('https://api.deepseek.com/responses'),
                requestBody,
                apiKey,
                3,
                signal,
            );
            if (signal.aborted) throw new Error('The request was cancelled by the user.');`,
    ],
    [
        `            const toolOutputs: ResponseOutputItem[] = await Promise.all(calls.map(async (call: ResponseOutputItem): Promise<ResponseOutputItem> => {
                const result = await this.executeTool(call.name ?? '', call.arguments ?? '{}', workspacePath, apiKey, 'deepseek', searxngBaseUrl);`,
        `            const toolOutputs: ResponseOutputItem[] = await Promise.all(calls.map(async (call: ResponseOutputItem): Promise<ResponseOutputItem> => {
                const result = await this.executeTool(call.name ?? '', call.arguments ?? '{}', workspacePath, apiKey, 'deepseek', searxngBaseUrl, signal);`,
    ],
    // 10. GLM loop: same treatment.
    [
        `        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);
            let response: GlmCompletionResponse;`,
        `        const signal = (this.abortController = new AbortController()).signal;
        for (let round = 0; round <= normalizedMaxToolRounds; round += 1) {
            if (signal.aborted) throw new Error('The request was cancelled by the user.');
            this.emitProgress(round === 0 ? 'Working on your request…' : \`Step \${round + 1}: thinking…\`);
            let response: GlmCompletionResponse;`,
    ],
    [
        `                    response = await requestJsonWithRetry<GlmCompletionResponse>(
                        endpoint,
                        requestBody,
                        apiKey,
                    );
                    break;`,
        `                    response = await requestJsonWithRetry<GlmCompletionResponse>(
                        endpoint,
                        requestBody,
                        apiKey,
                        3,
                        signal,
                    );
                    break;`,
    ],
    [
        `                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    // Only timeouts are worth retrying/fallback; hard errors
                    // (auth, quota, unknown model) should surface immediately.`,
        `                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (signal.aborted) {
                        throw new Error('The request was cancelled by the user.');
                    }
                    // Only timeouts are worth retrying/fallback; hard errors
                    // (auth, quota, unknown model) should surface immediately.`,
    ],
    [
        `                const result = await this.executeTool(toolName, rawArgs, workspacePath, apiKey, 'glm', searxngBaseUrl);`,
        `                if (signal.aborted) throw new Error('The request was cancelled by the user.');
                const result = await this.executeTool(toolName, rawArgs, workspacePath, apiKey, 'glm', searxngBaseUrl, signal);`,
    ],
]);

// --- extension.ts -----------------------------------------------------------

await patch('src/extension.ts', [
    // Stop now also cancels the in-flight agent run.
    [
        `    private async stopQueue(view: vscode.WebviewView): Promise<void> {
        await this.context.workspaceState.update(PROMPT_QUEUE_STOP_KEY, true);
        this.postState(view);
    }`,
        `    private async stopQueue(view: vscode.WebviewView): Promise<void> {
        await this.context.workspaceState.update(PROMPT_QUEUE_STOP_KEY, true);
        // Interrupt the in-flight run immediately: abort the current model
        // request / shell command, not just the remaining queue items.
        this.agent.cancel();
        this.postState(view);
    }`,
    ],
    // When the agent errors out because it was cancelled, mark the assistant
    // message clearly instead of the generic "Request failed".
    [
        `        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            const source = classifySource(error);
            await recordError(this.context, source, error);
            await this.save(conv.id, [...messages, { role: 'assistant', content: \`Request failed: \${detail}\` }]);
        }`,
        `        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            if (/was cancelled by the user|was cancelled/i.test(detail)) {
                await this.save(conv.id, [...messages, { role: 'assistant', content: '⏹ Stopped by user.' }]);
                this.postState(view);
                return;
            }
            const source = classifySource(error);
            await recordError(this.context, source, error);
            await this.save(conv.id, [...messages, { role: 'assistant', content: \`Request failed: \${detail}\` }]);
        }`,
    ],
]);

console.log('done');
