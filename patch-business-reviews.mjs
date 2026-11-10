import fs from 'fs';
import * as path from 'path';

// Insert the business-reviews import after the gmail import in agent.ts
const agentPath = path.join('src', 'agent.ts');
let agent = fs.readFileSync(agentPath, 'utf8');

const importMarker = "import type { GmailToolArgs } from './gmail';";
const businessImport = "import type { BusinessToolArgs } from './business-reviews';";
if (!agent.includes(businessImport)) {
    agent = agent.replace(importMarker, importMarker + '\n' + businessImport);
    console.log('agent.ts: import added');
}

// Add a businessReviewsHandler constructor parameter after gmailHandler
const ctorOld = `private calendarHandler?: (args: Record<string, unknown>) => Promise<string>,
        private gmailHandler?: (args: Record<string, unknown>) => Promise<string>,`;
const ctorNew = `private calendarHandler?: (args: Record<string, unknown>) => Promise<string>,
        private gmailHandler?: (args: Record<string, unknown>) => Promise<string>,
        private businessReviewsHandler?: (args: Record<string, unknown>) => Promise<string>,`;
if (agent.includes(ctorOld)) {
    agent = agent.replace(ctorOld, ctorNew);
    console.log('agent.ts: constructor param added');
} else {
    console.log('agent.ts: constructor param marker NOT FOUND');
}

// Add the tool definitions after reply_email's definition
const replyDefEnd = `    {
        type: 'function',
        name: 'reply_email',
        description: 'Reply to an existing Gmail message by ID. Requires user confirmation before executing.',
        parameters: {
            type: 'object',
            properties: {
                messageId: { type: 'string', description: 'The Gmail message ID to reply to.' },
                body: { type: 'string', description: 'Reply body text.' },
            },
            required: ['messageId', 'body'],
            additionalProperties: false,
        },
    },
];`;
const businessTools = `    {
        type: 'function',
        name: 'list_business_reviews',
        description: 'List Google Business Profile reviews for the user's business location. Read-only; runs without confirmation.',
        parameters: {
            type: 'object',
            properties: {
                pageSize: { type: 'number', description: 'Max reviews (default 20, max 50).' },
                orderBy: { type: 'string', description: 'Sort order: rating, rating desc, or updateTime desc.' },
            },
            required: [],
            additionalProperties: false,
        },
    },
    {
        type: 'function',
        name: 'reply_business_review',
        description: 'Reply to a Google Business Profile review. Requires user confirmation before executing.',
        parameters: {
            type: 'object',
            properties: {
                reviewName: { type: 'string', description: 'Full review name: accounts/{account}/locations/{location}/reviews/{review}' },
                replyComment: { type: 'string', description: 'The reply text to post publicly.' },
            },
            required: ['reviewName', 'replyComment'],
            additionalProperties: false,
        },
    },
];`;
if (agent.includes(replyDefEnd)) {
    agent = agent.replace(replyDefEnd, businessTools);
    console.log('agent.ts: tool definitions added');
} else {
    console.log('agent.ts: tool definition marker NOT FOUND');
}

// Add the executeTool branch after the gmail branch
const gmailBranchOld = `            } else if (name === 'list_emails' || name === 'search_emails' || name === 'read_email' || name === 'send_email' || name === 'reply_email') {
                if (this.gmailHandler) {
                    return await this.gmailHandler({
                        action: name === 'list_emails' ? 'list' : name === 'search_emails' ? 'search' : name === 'read_email' ? 'read' : name === 'send_email' ? 'send' : 'reply',
                        ...args,
                    });
                }
                return JSON.stringify({ error: 'Gmail is not connected in this session.' });
            }`;
const businessBranchNew = gmailBranchOld + ` else if (name === 'list_business_reviews' || name === 'reply_business_review') {
                if (this.businessReviewsHandler) {
                    return await this.businessReviewsHandler({
                        action: name === 'list_business_reviews' ? 'list_reviews' : 'reply_review',
                        ...args,
                    });
                }
                return JSON.stringify({ error: 'Google Business Profile is not connected in this session.' });
            }`;
if (agent.includes(gmailBranchOld)) {
    agent = agent.replace(gmailBranchOld, businessBranchNew);
    console.log('agent.ts: executeTool branch added');
} else {
    console.log('agent.ts: executeTool branch marker NOT FOUND');
}

fs.writeFileSync(agentPath, agent);

// ---------------------------------------------------------------------------
// extension.ts changes
const extPath = path.join('src', 'extension.ts');
let ext = fs.readFileSync(extPath, 'utf8');

// 1. Add import
const gmailImportEnd = `    isGmailReadOnly,
} from './gmail';`;
const businessImportExt = `    isGmailReadOnly,
} from './gmail';
import {
    BUSINESS_TOKENS_SECRET,
    BusinessToolArgs,
    buildBusinessAuthorizationUrl,
    exchangeBusinessCodeForTokens,
    refreshBusinessAccessToken,
    runBusinessTool,
    runConfirmedBusinessMutation,
    normalizeTokens as normalizeBusinessTokens,
    isTokenExpired as isBusinessTokenExpired,
    isBusinessReadOnly,
} from './business-reviews';`;
if (ext.includes(gmailImportEnd) && !ext.includes("from './business-reviews'")) {
    ext = ext.replace(gmailImportEnd, businessImportExt);
    console.log('extension.ts: import added');
}

// 2. Add createBusinessReviewsHandler after createGmailHandler (which ends right before "class CodingAgentChatProvider")
const gmailHandlerEnd = `        const result = await runConfirmedGmailMutation(args, tokens);
        if (!result.ok) {
            void vscode.window.showErrorMessage(result.message);
        }
        return JSON.stringify(result);
    };
}

class CodingAgentChatProvider`;
const businessHandler = `        const result = await runConfirmedGmailMutation(args, tokens);
        if (!result.ok) {
            void vscode.window.showErrorMessage(result.message);
        }
        return JSON.stringify(result);
    };
}

function createBusinessReviewsHandler(context: vscode.ExtensionContext): (args: Record<string, unknown>) => Promise<string> {
    return async (rawArgs: Record<string, unknown>): Promise<string> => {
        const args = rawArgs as unknown as BusinessToolArgs;

        const credentials = {
            clientId: await context.secrets.get(GMAIL_CLIENT_ID_SECRET) ?? '',
            clientSecret: await context.secrets.get(GMAIL_CLIENT_SECRET_SECRET) ?? '',
        };
        if (!credentials.clientId || !credentials.clientSecret) {
            const message = 'Google Business Profile is not configured. Run "Coding Agent: Configure Google Calendar" (Ctrl+Shift+P), paste your Desktop-app Client ID and Secret, then reload.';
            void vscode.window.showErrorMessage(message);
            return JSON.stringify({ error: message });
        }

        const readTokens = async () => {
            const stored = context.globalState.get<unknown>(BUSINESS_TOKENS_SECRET);
            if (typeof stored === 'string') {
                try { return normalizeBusinessTokens(JSON.parse(stored)); } catch { return null; }
            }
            return normalizeBusinessTokens(stored);
        };
        const saveTokens = async (tokens: { access_token: string; refresh_token?: string; expires_at?: number }) => {
            await context.globalState.update(BUSINESS_TOKENS_SECRET, tokens);
        };

        const authorize = async (): Promise<{ access_token: string; refresh_token?: string; expires_at?: number }> => {
            const authUrl = buildBusinessAuthorizationUrl(credentials.clientId);
            void vscode.window.showInformationMessage('Opening browser to authorize Google Business Profile. After allowing access, paste the code from the redirected URL.');
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));
            const code = await vscode.window.showInputBox({
                prompt: 'Paste the authorization code from the browser after allowing access.',
                password: true,
                ignoreFocusOut: true,
            });
            if (!code) throw new Error('Authorization cancelled.');
            const exchanged = await exchangeBusinessCodeForTokens(credentials.clientId, credentials.clientSecret, code.trim());
            await saveTokens(exchanged);
            return exchanged;
        };

        if (isBusinessReadOnly(args.action)) {
            const result = await runBusinessTool(
                args,
                readTokens,
                async () => credentials,
                saveTokens,
                async () => undefined,
            );
            if (!result.needsAuthorization) {
                return JSON.stringify(result);
            }
            try {
                await authorize();
                const retried = await runBusinessTool(args, readTokens, async () => credentials, saveTokens, async () => undefined);
                return JSON.stringify(retried);
            } catch (error) {
                const detail = error instanceof Error ? error.message : 'Unknown error';
                const message = `Google Business Profile authorization failed: ${detail}`;
                await recordError(context, 'business-reviews', error);
                void vscode.window.showErrorMessage(message);
                return JSON.stringify({ ok: false, message });
            }
        }

        // Mutations require confirmation first.
        const confirmMessage = buildBusinessConfirmationMessage(args);
        const choice = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Reply',
            'Cancel',
        );
        if (choice !== 'Reply') {
            return JSON.stringify({ ok: false, message: 'Review reply cancelled by the user.' });
        }

        let tokens = (await readTokens()) ?? (await authorize());

        if (isBusinessTokenExpired(tokens)) {
            if (tokens.refresh_token) {
                tokens = await refreshBusinessAccessToken(credentials.clientId, credentials.clientSecret, tokens.refresh_token);
                await saveTokens(tokens);
            } else {
                return JSON.stringify({ error: 'Google Business Profile token expired. Re-authorize by reconfiguring Google credentials.' });
            }
        }

        if (!tokens.access_token) {
            const message = 'Google Business Profile is not authorized yet.';
            void vscode.window.showErrorMessage(message);
            return JSON.stringify({ error: message });
        }

        const result = await runConfirmedBusinessMutation(args, tokens);
        if (!result.ok) {
            void vscode.window.showErrorMessage(result.message);
        }
        return JSON.stringify(result);
    };
}

class CodingAgentChatProvider`;
if (ext.includes(gmailHandlerEnd) && !ext.includes('createBusinessReviewsHandler')) {
    ext = ext.replace(gmailHandlerEnd, businessHandler);
    console.log('extension.ts: business handler added');
}

// 3. Wire handler into CodingAgent constructor call
const agentCtorOld = `        createCalendarHandler(context),
        createGmailHandler(context),
    );`;
const agentCtorNew = `        createCalendarHandler(context),
        createGmailHandler(context),
        createBusinessReviewsHandler(context),
    );`;
if (ext.includes(agentCtorOld)) {
    ext = ext.replace(agentCtorOld, agentCtorNew);
    console.log('extension.ts: handler wired into agent');
}

// 4. Also clear business tokens in forgetGoogleTokens
const forgetOld = `        await context.globalState.update(GOOGLE_TOKENS_SECRET, undefined);
        await context.globalState.update(GMAIL_TOKENS_SECRET, undefined);`;
const forgetNew = `        await context.globalState.update(GOOGLE_TOKENS_SECRET, undefined);
        await context.globalState.update(GMAIL_TOKENS_SECRET, undefined);
        await context.globalState.update(BUSINESS_TOKENS_SECRET, undefined);`;
if (ext.includes(forgetOld)) {
    ext = ext.replace(forgetOld, forgetNew);
    console.log('extension.ts: forgetGoogleTokens updated');
}

fs.writeFileSync(extPath, ext);

console.log('All patches applied.');
