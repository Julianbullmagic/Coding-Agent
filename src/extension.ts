import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { CodingAgent } from './agent';
// import { ensureLocalSearxng } from './searxng'; // SearXNG disabled: using DeepSeek web_search
import { checkLatestModel } from './model-check';
import { createGitHubStatusBar } from './github';
import { backupWorkspaceToGitHub, isGitHubCliInstalled, isGitHubAuthenticated } from './backup';
import { LOGIN_COMMAND, LOGIN_TERMINAL_NAME, LOGIN_POLL_INTERVAL_MS, LOGIN_POLL_TIMEOUT_MS, shouldKeepPolling, nextPollDelay, buildLoginSuccessMessage, buildLoginTimeoutWarning } from './login-flow';

const API_KEY_SECRET = 'codingAgent.deepseekApiKey';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface Conversation { id: string; title: string; updatedAt: number; messages: ChatMessage[]; }

function summarizeConversation(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find((message) => message.role === 'user')?.content.trim();
    if (!firstUserMessage) return 'New conversation';

    const firstSentence = firstUserMessage
        .split(/(?<=[.!?])\s+/)[0]
        .replace(/^(?:please\s+)?(?:can|could|would|will|please)\s+(?:you\s+)?/i, '')
        .replace(/^make\s+(?:me\s+)?/i, '')
        .replace(/\s+/g, ' ')
        .replace(/[.!?]+$/, '')
        .trim();

    const summary = firstSentence || firstUserMessage;
    return summary.length > 42 ? `${summary.slice(0, 39).trim()}...` : summary;
}

class CodingAgentChatProvider implements vscode.WebviewViewProvider {
    constructor(private readonly context: vscode.ExtensionContext, private readonly agent: CodingAgent) {}

    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html();
        this.postState(view);
        view.webview.onDidReceiveMessage(async (message: { type: string; id?: string; text?: string }) => {
            if (message.type === 'ready') {
                this.postState(view);
            } else if (message.type === 'new') {
                await this.createConversation();
                this.postState(view);
            } else if (message.type === 'open' && message.id) {
                await this.context.workspaceState.update('codingAgent.activeConversation', message.id);
                this.postState(view);
            } else if (message.type === 'delete' && message.id) {
                await this.deleteConversation(message.id);
                this.postState(view);
            } else if (message.type === 'send' && message.text?.trim()) {
                await this.send(view, message.text.trim());
            } else if (message.type === 'setApiKey') {
                await vscode.commands.executeCommand('codingAgent.setApiKey');
                this.postState(view);
            }
        });
    }

    private conversations(): Conversation[] {
        const workspaceConversations = this.context.workspaceState.get<Conversation[]>('codingAgent.conversations', []);
        const stored = workspaceConversations.length > 0
            ? workspaceConversations
            : this.context.globalState.get<Conversation[]>('codingAgent.conversations', []);
        const summarized = stored.map((conversation) => ({
            ...conversation,
            title: summarizeConversation(conversation.messages),
        }));
        if (stored.length > 0 && summarized.some((conversation, index) => conversation.title !== stored[index]?.title)) {
            void this.context.workspaceState.update('codingAgent.conversations', summarized);
        }
        return summarized;
    }

    private async createConversation(): Promise<Conversation> {
        const conversation: Conversation = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: 'New conversation', updatedAt: Date.now(), messages: [] };
        await this.context.workspaceState.update('codingAgent.conversations', [conversation, ...this.conversations()]);
        await this.context.workspaceState.update('codingAgent.activeConversation', conversation.id);
        return conversation;
    }

    private active(): Conversation | undefined {
        const activeId = this.context.workspaceState.get<string>('codingAgent.activeConversation')
            ?? this.context.globalState.get<string>('codingAgent.activeConversation');
        return this.conversations().find((conversation) => conversation.id === activeId) ?? this.conversations()[0];
    }

    private async deleteConversation(conversationId: string): Promise<void> {
        const remaining = this.conversations().filter((conversation) => conversation.id !== conversationId);
        await this.context.workspaceState.update('codingAgent.conversations', remaining);
        await this.context.globalState.update('codingAgent.conversations', remaining);

        const activeId = this.context.workspaceState.get<string>('codingAgent.activeConversation')
            ?? this.context.globalState.get<string>('codingAgent.activeConversation');
        if (activeId === conversationId) {
            const nextId = remaining[0]?.id;
            await this.context.workspaceState.update('codingAgent.activeConversation', nextId);
            await this.context.globalState.update('codingAgent.activeConversation', nextId);
        }
    }

    private async save(conversationId: string, messages: ChatMessage[]): Promise<void> {
        const updated = this.conversations().map((conversation) => conversation.id === conversationId ? {
            ...conversation,
            title: summarizeConversation(messages),
            messages,
            updatedAt: Date.now(),
        } : conversation);
        await this.context.workspaceState.update('codingAgent.conversations', updated);
        await this.context.globalState.update('codingAgent.conversations', updated);
    }

    private async send(view: vscode.WebviewView, text: string): Promise<void> {
        let conversation = this.active();
        if (!conversation) conversation = await this.createConversation();
        const history = conversation.messages;
        const messages = [...history, { role: 'user' as const, content: text }];
        await this.save(conversation.id, messages);
        this.postState(view, true);

        const pendingUpdate = this.context.globalState.get<{
            modelId: string;
            version: string;
        }>('codingAgent.pendingModelUpdate');
        if (pendingUpdate) {
            const details = pendingUpdate.version ? ` (${pendingUpdate.version})` : '';
            await vscode.window.showInformationMessage(
                `New DeepSeek model available: ${pendingUpdate.modelId}${details}. It will be used for this chat.`,
            );
            const config = vscode.workspace.getConfiguration('codingAgent');
            await config.update('model', pendingUpdate.modelId, vscode.ConfigurationTarget.Global);
            this.agent.setModel(pendingUpdate.modelId);
            await this.context.globalState.update('codingAgent.knownModelVersion', pendingUpdate.version);
            await this.context.globalState.update('codingAgent.pendingModelUpdate', undefined);
        }

        const apiKey = await this.context.secrets.get(API_KEY_SECRET);
        if (!apiKey) {
            await vscode.commands.executeCommand('codingAgent.setApiKey');
            this.postState(view);
            return;
        }
        try {
            const searxngBaseUrl = vscode.workspace.getConfiguration('codingAgent').get<string>('searxngBaseUrl', 'http://localhost:8080');
            const maxToolRounds = vscode.workspace.getConfiguration('codingAgent').get<number>('maxToolRounds', 1000);
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
            const response = await this.agent.provideSuggestions(text, apiKey, searxngBaseUrl, history, workspacePath, maxToolRounds);
            await this.save(conversation.id, [...messages, { role: 'assistant', content: response.trim() }]);
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            await this.save(conversation.id, [...messages, { role: 'assistant', content: `Request failed: ${detail}` }]);
        }
        this.postState(view);
    }

    private postState(view: vscode.WebviewView, loading = false): void {
        void view.webview.postMessage({ type: 'state', conversations: this.conversations(), activeId: this.context.workspaceState.get<string>('codingAgent.activeConversation') ?? this.context.globalState.get<string>('codingAgent.activeConversation'), loading });
    }

    private html(): string {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        :root{color-scheme:light dark}*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;font-family:var(--vscode-font-family);font-size:12px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}.shell{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr)}.tabs{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--vscode-panel-border)}.tab{height:38px;border-radius:0;background:transparent;color:var(--vscode-foreground)}.tab.active{box-shadow:inset 0 -2px var(--vscode-focusBorder);background:var(--vscode-list-hoverBackground)}.panel{display:none!important;min-height:0;overflow:hidden}.panel.active{display:block!important}.sidebar{overflow-y:auto;padding:8px}.chat{min-width:0;height:100%}.chat.active{display:grid!important;grid-template-rows:minmax(0,1fr) auto}.messages{min-height:0;overflow-y:auto;padding:12px 10px}.message{margin:8px 0;padding:8px;border-radius:6px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}.user{background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);margin-left:12px}.assistant{border-left:2px solid var(--vscode-focusBorder)}button{border:0;border-radius:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);cursor:pointer}.new{width:100%;min-height:36px;height:auto;margin-bottom:8px;padding:8px 6px;line-height:18px;white-space:normal}.conversation{display:block;width:100%;min-height:36px;height:auto;text-align:left;margin:3px 0;padding:7px 8px;background:transparent;color:var(--vscode-sideBar-foreground);white-space:normal;overflow-wrap:anywhere;line-height:16px}.conversation.active{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.conversation-row{display:flex;align-items:stretch;gap:4px}.conversation-row .conversation{flex:1;min-width:0}.delete-conversation{flex:0 0 24px;width:24px;height:24px;margin-top:6px;padding:0;line-height:22px;background:transparent;color:var(--vscode-descriptionForeground)}.delete-conversation:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-errorForeground)}.composer{display:flex;align-items:flex-end;gap:8px;padding:8px;border-top:1px solid var(--vscode-panel-border)}textarea{resize:none;flex:1;min-width:0;min-height:40px;padding:8px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit}.send{flex:0 0 58px;width:58px;height:40px;padding:0;line-height:40px}.send:disabled{cursor:default;opacity:.55}.loading{opacity:.7}@media(max-width:280px){.composer{gap:4px;padding:6px}.send{flex-basis:48px;width:48px}}
        </style></head><body><div class="shell"><nav class="tabs" aria-label="Coding Agent views"><button class="tab" id="historyTab">History</button><button class="tab active" id="chatTab">Chat</button></nav><aside class="panel sidebar" id="historyPanel"><button class="new" id="new">+ New chat</button><div id="history"></div></aside><main class="panel chat active" id="chatPanel"><div class="messages" id="messages"></div><div class="composer"><textarea id="input" rows="1" placeholder="Message DeepSeek Coding Agent"></textarea><button class="send" id="send">Send</button></div></main></div><script>
        const vscode=acquireVsCodeApi();let state={conversations:[],activeId:'',loading:false};const messages=document.getElementById('messages'),history=document.getElementById('history'),input=document.getElementById('input'),send=document.getElementById('send'),chatTab=document.getElementById('chatTab'),historyTab=document.getElementById('historyTab'),chatPanel=document.getElementById('chatPanel'),historyPanel=document.getElementById('historyPanel');function selectTab(tab){const showChat=tab==='chat';chatTab.classList.toggle('active',showChat);historyTab.classList.toggle('active',!showChat);chatPanel.classList.toggle('active',showChat);historyPanel.classList.toggle('active',!showChat)}chatTab.onclick=()=>selectTab('chat');historyTab.onclick=()=>selectTab('history');document.getElementById('new').onclick=()=>{vscode.postMessage({type:'new'});selectTab('chat')};send.onclick=()=>{const text=input.value.trim();if(!text||state.loading)return;input.value='';vscode.postMessage({type:'send',text})};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send.click()}};addEventListener('message',event=>{if(event.data.type!=='state')return;state=event.data;history.replaceChildren();for(const conversation of state.conversations||[]){const row=document.createElement('div');row.className='conversation-row';const button=document.createElement('button');button.className='conversation'+(conversation.id===state.activeId?' active':'');button.textContent=conversation.title;button.title=conversation.title;button.onclick=()=>{vscode.postMessage({type:'open',id:conversation.id});selectTab('chat')};const remove=document.createElement('button');remove.className='delete-conversation';remove.textContent='x';remove.title='Delete conversation';remove.setAttribute('aria-label','Delete conversation');remove.onclick=()=>vscode.postMessage({type:'delete',id:conversation.id});row.appendChild(button);row.appendChild(remove);history.appendChild(row)}const conversation=(state.conversations||[]).find(item=>item.id===state.activeId);messages.replaceChildren();for(const message of conversation?conversation.messages:[]){const element=document.createElement('div');element.className='message '+message.role;element.textContent=message.content;messages.appendChild(element)}if(state.loading){const element=document.createElement('div');element.className='message assistant loading';element.textContent='Thinking...';messages.appendChild(element)}send.disabled=state.loading;messages.scrollTop=messages.scrollHeight});vscode.postMessage({type:'ready'});
        </script></body></html>`;
    }
}

function startAutoBackup(context: vscode.ExtensionContext): { dispose(): void } {
    const workspacePath = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    let timer: ReturnType<typeof setInterval> | undefined;
    let running = false;

    const run = async (): Promise<void> => {
        const config = vscode.workspace.getConfiguration('codingAgent');
        if (!config.get<boolean>('autoBackupToGitHub', false)) return;
        if (running) return;
        running = true;
        try {
            if (!isGitHubCliInstalled()) return;
            if (!(await isGitHubAuthenticated(workspacePath()))) return;
            await backupWorkspaceToGitHub(workspacePath(), 'coding-agent-backup');
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showWarningMessage(`Automatic GitHub backup failed: ${detail}`);
        } finally {
            running = false;
        }
    };

    const reschedule = (): void => {
        if (timer) clearInterval(timer);
        const config = vscode.workspace.getConfiguration('codingAgent');
        if (!config.get<boolean>('autoBackupToGitHub', false)) return;
        const minutes = Math.max(1, Math.min(1440, Math.floor(config.get<number>('autoBackupIntervalMinutes', 30))));
        timer = setInterval(() => { void run(); }, minutes * 60 * 1000);
    };

    void run();
    reschedule();
    const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codingAgent.autoBackupToGitHub')
            || event.affectsConfiguration('codingAgent.autoBackupIntervalMinutes')) {
            reschedule();
        }
    });

    return { dispose(): void { if (timer) clearInterval(timer); onConfig.dispose(); } };
}

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('codingAgent');
    const agent = new CodingAgent(config.get<string>('model', 'deepseek-v4-pro'));

    const githubStatusBar = createGitHubStatusBar();
    context.subscriptions.push(githubStatusBar);
    if (config.get<boolean>('promptForGitHubLogin', true)) {
        void githubStatusBar.refresh();
    }
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codingAgent.chat', new CodingAgentChatProvider(context, agent)),
    );
    if (config.get<boolean>('autoCheckModelUpdates', true)) {
        void (async () => {
            try {
                const apiKey = await context.secrets.get(API_KEY_SECRET);
                const currentModel = config.get<string>('model', 'deepseek-v4-pro');
                const latest = await checkLatestModel(apiKey, currentModel);
                if (latest.id && latest.id !== currentModel) {
                    const details = latest.version ? ` (${latest.version})` : '';
                    await context.globalState.update('codingAgent.pendingModelUpdate', {
                        modelId: latest.id,
                        version: latest.version,
                    });
                } else if (latest.version) {
                    const knownVersion = context.globalState.get<string>('codingAgent.knownModelVersion');
                    if (!knownVersion) {
                        await context.globalState.update('codingAgent.knownModelVersion', latest.version);
                    } else if (knownVersion !== latest.version) {
                        await context.globalState.update('codingAgent.pendingModelUpdate', {
                            modelId: latest.id || currentModel,
                            version: latest.version,
                        });
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown model-check error';
                void vscode.window.showWarningMessage(`Automatic DeepSeek model check failed: ${message}`);
            }
        })();
    }
    // if (config.get<boolean>('autoStartSearxng', true)) {
//         const searxngBaseUrl = config.get<string>('searxngBaseUrl', 'http://localhost:8080');
//         void vscode.window.withProgress(
//             {
//                 location: vscode.ProgressLocation.Notification,
//                 title: 'Starting local SearXNG if needed',
//                 cancellable: false,
//             },
//             async () => {
//                 try {
//                     const started = await ensureLocalSearxng(context, searxngBaseUrl);
//                     if (started) {
//                         void vscode.window.showInformationMessage('Local SearXNG is ready for web searches.');
//                     }
//                 } catch (error) {
//                     const message = error instanceof Error ? error.message : 'Unknown startup error';
//                     void vscode.window.showWarningMessage(
//                         `Could not auto-start SearXNG: ${message}. DeepSeek web search is still available.`,
//                     );
//                 }
//             },
//         );
//     }

    const loginGitHub = vscode.commands.registerCommand('codingAgent.loginGitHub', async () => {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const terminal = vscode.window.createTerminal({
            name: LOGIN_TERMINAL_NAME,
            cwd: workspacePath || undefined,
            hideFromUser: false,
        });
        terminal.show();

        // gh auth login --web opens the browser and prints a one-time device
        // code. Running it in a visible terminal lets the user see that code,
        // complete the browser flow, and lets gh poll until authorization
        // succeeds -- the natural interactive experience.
        terminal.sendText(LOGIN_COMMAND);

        // Poll for completion so we can refresh the status bar and finish setup.
        const started = Date.now();
        const timeoutMs = LOGIN_POLL_TIMEOUT_MS;
        const poll = async (): Promise<void> => {
            if (!shouldKeepPolling(started, Date.now(), timeoutMs)) {
                void vscode.window.showWarningMessage(
                    buildLoginTimeoutWarning(),
                );
                return;
            }
            if (await isGitHubAuthenticated(workspacePath ?? process.cwd())) {
                await vscode.commands.executeCommand('codingAgent.configureGitIdentity');
                await githubStatusBar.refresh();
                void vscode.window.showInformationMessage(
                    buildLoginSuccessMessage(),
                );
                return;
            }
            setTimeout(() => { void poll(); }, nextPollDelay(LOGIN_POLL_INTERVAL_MS));
        };
        void poll();
    });

    const configureGitIdentity = vscode.commands.registerCommand('codingAgent.configureGitIdentity', async () => {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspacePath) {
            void vscode.window.showWarningMessage('Open a folder or workspace before configuring Git identity.');
            return;
        }
        try {
            await new Promise<void>((resolve, reject) => {
                const setup = spawn('gh', ['auth', 'setup-git'], { cwd: workspacePath, env: process.env, windowsHide: true });
                setup.once('error', reject);
                setup.once('close', (code) => code === 0 ? resolve() : reject(new Error(`gh auth setup-git exited with code ${code ?? 'unknown'}.`)));
            });

            const user = await new Promise<{ login?: string; name?: string; email?: string }>((resolve, reject) => {
                const api = spawn('gh', ['api', 'user'], { cwd: workspacePath, env: process.env, windowsHide: true });
                let output = '';
                let errors = '';
                api.stdout?.on('data', (chunk: Buffer | string) => { output += chunk.toString(); });
                api.stderr?.on('data', (chunk: Buffer | string) => { errors += chunk.toString(); });
                api.once('error', reject);
                api.once('close', (code) => {
                    if (code !== 0) reject(new Error(errors.trim() || 'Could not read the GitHub account.'));
                    else {
                        try { resolve(JSON.parse(output) as { login?: string; name?: string; email?: string }); }
                        catch { reject(new Error('GitHub returned an unreadable account response.')); }
                    }
                });
            });

            const login = user.login?.trim();
            const name = user.name?.trim() || login;
            const email = user.email?.trim() || (login ? `${login}@users.noreply.github.com` : undefined);
            if (!name || !email) throw new Error('GitHub did not provide an account name or login.');

            for (const args of [['config', '--local', 'user.name', name], ['config', '--local', 'user.email', email]] ) {
                await new Promise<void>((resolve, reject) => {
                    const git = spawn('git', args, { cwd: workspacePath, env: process.env, windowsHide: true });
                    git.once('error', reject);
                    git.once('close', (code) => code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} exited with code ${code ?? 'unknown'}.`)));
                });
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`GitHub setup failed: ${detail}`);
        }
    });

    const autoBackupTimer = startAutoBackup(context);
    context.subscriptions.push(autoBackupTimer);

    const backupNow = vscode.commands.registerCommand('codingAgent.backupNow', async () => {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        try {
            const result = await backupWorkspaceToGitHub(workspacePath, 'coding-agent-backup');
            void vscode.window.showInformationMessage(result.message);
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Unknown error';
            void vscode.window.showErrorMessage(`Backup failed: ${detail}`);
        }
    });

    const setApiKey = vscode.commands.registerCommand('codingAgent.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your DeepSeek API key. It will be stored securely by VS Code.',
            password: true,
            ignoreFocusOut: true,
        });

        if (apiKey === undefined) {
            return;
        }

        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            void vscode.window.showWarningMessage('The API key cannot be empty.');
            return;
        }

        await context.secrets.store(API_KEY_SECRET, trimmedKey);
        void vscode.window.showInformationMessage('DeepSeek API key saved securely.');
    });

    const askDeepSeek = vscode.commands.registerCommand('codingAgent.askDeepSeek', async () => {
        await vscode.commands.executeCommand('codingAgent.chat.focus');
    });

    const newConversation = vscode.commands.registerCommand('codingAgent.newConversation', async () => {
        const conversations = context.workspaceState.get<Conversation[]>('codingAgent.conversations', [])
            ?? context.globalState.get<Conversation[]>('codingAgent.conversations', []);
        const conversation: Conversation = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: 'New conversation',
            updatedAt: Date.now(),
            messages: [],
        };
        await context.workspaceState.update('codingAgent.conversations', [conversation, ...conversations]);
        await context.workspaceState.update('codingAgent.activeConversation', conversation.id);
        await vscode.commands.executeCommand('codingAgent.chat.focus');
    });

    context.subscriptions.push(
        setApiKey,
        askDeepSeek,
        newConversation,
        loginGitHub,
        configureGitIdentity,
        backupNow,
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (config.get<boolean>('promptForGitHubLogin', true)) {
                void githubStatusBar.refresh();
            }
        }),
    );
}

export function deactivate(): void {}