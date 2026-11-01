import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/extension.ts';
let src = readFileSync(path, 'utf8');

const report = (label, before, after) => {
    const count = src.split(before).length - 1;
    if (count !== 1) {
        throw new Error(`[${label}] expected exactly 1 occurrence, found ${count}`);
    }
    src = src.replace(before, after);
    console.log(`OK  ${label}`);
};

// 1. Make postState resolve activeId through active() so it falls back to
//    conversations[0] instead of sending a raw (possibly undefined) id.
report(
    'postState activeId fallback',
    `    private postState(view: vscode.WebviewView, loading = false): void {
        void view.webview.postMessage({ type: 'state', conversations: this.conversations(), activeId: this.context.workspaceState.get<string>('codingAgent.activeConversation') ?? this.context.globalState.get<string>('codingAgent.activeConversation'), loading });
    }`,
    `    private postState(view: vscode.WebviewView, loading = false): void {
        // Resolve the active conversation through active(), which falls back to
        // the first conversation. This guarantees the frontend always receives a
        // valid activeId, so a fresh load shows a usable chat without requiring
        // the user to click "New chat" or an older conversation first.
        let activeConversation = this.active();
        if (!activeConversation) {
            void this.createConversation().then((created) => {
                activeConversation = created;
                this.postState(view, loading);
            });
            return;
        }
        void view.webview.postMessage({ type: 'state', conversations: this.conversations(), activeId: activeConversation.id, loading });
    }`,
);

// 2. Auto-create a conversation on view resolve so a fresh workspace always
//    has an active conversation ready before the webview finishes loading.
report(
    'auto-create on resolve',
    `    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html();
        this.postState(view);`,
    `    resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html();
        // Ensure an active conversation exists before posting the first state,
        // so the chat is immediately usable on a fresh open.
        if (this.conversations().length === 0) {
            void this.createConversation().then(() => this.postState(view));
        } else if (!this.active()) {
            void this.context.workspaceState.update('codingAgent.activeConversation', this.conversations()[0].id).then(() => this.postState(view));
        } else {
            this.postState(view);
        }`,
);

writeFileSync(path, src, 'utf8');
console.log('Wrote', path);
