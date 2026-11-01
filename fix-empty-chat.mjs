// Applies the "empty chat on fresh open" fix to src/extension.ts.
// Run with:  node fix-empty-chat.mjs
//
// It makes three surgical changes to CodingAgentChatProvider so the Chat tab
// always has an active, selectable conversation as soon as the webview opens.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/extension.ts';
let src = readFileSync(FILE, 'utf8');

function apply(anchor, replacement) {
  if (!src.includes(anchor)) {
    throw new Error('Anchor not found in ' + FILE + ':\n' + anchor.slice(0, 120));
  }
  if (src.split(anchor).length > 2) {
    throw new Error('Anchor is ambiguous (appears more than once):\n' + anchor.slice(0, 120));
  }
  src = src.replace(anchor, replacement);
}

// 1) Ensure an active conversation exists before the initial state is posted.
apply(
`        view.webview.html = this.html();
        this.postState(view);`,
`        view.webview.html = this.html();
        void this.ensureActiveConversation();
        this.postState(view);`
);

// 2) Add the ensureActiveConversation() helper right after active().
apply(
`        return this.conversations().find((conversation) => conversation.id === activeId) ?? this.conversations()[0];
    }

    private async deleteConversation(conversationId: string): Promise<void> {`,
`        return this.conversations().find((conversation) => conversation.id === activeId) ?? this.conversations()[0];
    }

    // Ensure there is always an active conversation so the Chat tab is usable
    // immediately on a fresh open without requiring the user to click "+ New chat".
    private async ensureActiveConversation(): Promise<void> {
        const list = this.conversations();
        if (list.length === 0) {
            await this.createConversation();
            return;
        }

        const activeId = this.context.workspaceState.get<string>('codingAgent.activeConversation')
            ?? this.context.globalState.get<string>('codingAgent.activeConversation');
        const stillExists = list.some((conversation) => conversation.id === activeId);
        if (!stillExists) {
            await this.context.workspaceState.update('codingAgent.activeConversation', list[0].id);
        }
    }

    private async deleteConversation(conversationId: string): Promise<void> {`
);

// 3) Make postState fall back to the first conversation id when no active id
//    is stored (so the Chat tab always renders something and the Send handler
//    sees a non-empty activeId).
apply(
`    private postState(view: vscode.WebviewView, loading = false): void {
        void view.webview.postMessage({ type: 'state', conversations: this.conversations(), activeId: this.context.workspaceState.get<string>('codingAgent.activeConversation') ?? this.context.globalState.get<string>('codingAgent.activeConversation'), loading });
    }`,
`    private postState(view: vscode.WebviewView, loading = false): void {
        const list = this.conversations();
        const activeId = this.context.workspaceState.get<string>('codingAgent.activeConversation')
            ?? this.context.globalState.get<string>('codingAgent.activeConversation')
            ?? list[0]?.id
            ?? '';
        void view.webview.postMessage({ type: 'state', conversations: list, activeId, loading });
    }`
);

writeFileSync(FILE, src, 'utf8');
console.log('Fixed ' + FILE + ' (3 edits applied). Now run: npm run compile');
