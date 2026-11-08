import * as https from 'https';
import * as vscode from 'vscode';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';

export const GMAIL_CLIENT_ID_SECRET = 'codingAgent.gmailClientId';
export const GMAIL_CLIENT_SECRET_SECRET = 'codingAgent.gmailClientSecret';
export const GMAIL_TOKENS_SECRET = 'codingAgent.gmailTokens';

interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
}

export interface GmailToolArgs {
    action: 'list' | 'search' | 'read' | 'send' | 'reply';
    messageId?: string;
    maxResults?: number;
    query?: string;
    to?: string;
    subject?: string;
    body?: string;
    cc?: string;
    bcc?: string;
    threadId?: string;
}

export interface GmailResult {
    ok: boolean;
    message: string;
    messages?: Array<{ id: string; threadId: string; snippet: string; from?: string; subject?: string; date?: string }>;
    body?: string;
    needsAuthorization?: boolean;
    needsConfirmation?: boolean;
    pendingAction?: GmailToolArgs;
}

/**
 * Parse and validate Gmail tool arguments. Returns an error string, or null if valid.
 */
export function validateGmailArgs(args: Record<string, unknown>): string | null {
    const action = args.action;
    if (typeof action !== 'string' || !['list', 'search', 'read', 'send', 'reply'].includes(action)) {
        return 'Invalid Gmail action. Use one of: list, search, read, send, reply.';
    }
    if (action === 'list') {
        return null;
    }
    if (action === 'search') {
        if (typeof args.query !== 'string' || !args.query.trim()) {
            return 'A query is required to search email.';
        }
        return null;
    }
    if (action === 'read') {
        if (typeof args.messageId !== 'string' || !args.messageId.trim()) {
            return 'A messageId is required to read an email.';
        }
        return null;
    }
    if (action === 'send') {
        if (typeof args.to !== 'string' || !args.to.trim()) {
            return 'A recipient (to) is required to send an email.';
        }
        if (typeof args.subject !== 'string' || !args.subject.trim()) {
            return 'A subject is required to send an email.';
        }
        if (typeof args.body !== 'string' || !args.body.trim()) {
            return 'A body is required to send an email.';
        }
        return null;
    }
    if (action === 'reply') {
        if (typeof args.messageId !== 'string' || !args.messageId.trim()) {
            return 'A messageId (the email to reply to) is required.';
        }
        if (typeof args.body !== 'string' || !args.body.trim()) {
            return 'A reply body is required.';
        }
        return null;
    }
    return null;
}

/**
 * Build a human-readable confirmation message for a mutation.
 */
export function buildGmailConfirmationMessage(args: GmailToolArgs): string {
    if (args.action === 'send') {
        const lines = [
            'Send email:',
            `  To: ${args.to}`,
            `  Subject: ${args.subject}`,
        ];
        if (args.cc) lines.push(`  Cc: ${args.cc}`);
        if (args.bcc) lines.push(`  Bcc: ${args.bcc}`);
        lines.push('  Body:');
        lines.push(`  ${args.body}`);
        return lines.join('\n');
    }
    if (args.action === 'reply') {
        const lines = [
            `Reply to email ${args.messageId}:`,
            '  Body:',
            `  ${args.body}`,
        ];
        return lines.join('\n');
    }
    return 'Unknown Gmail action.';
}

/**
 * Pure helper: decide whether an action is read-only.
 */
export function isGmailReadOnly(action: string): boolean {
    return action === 'list' || action === 'search' || action === 'read';
}

export function buildGmailAuthorizationUrl(clientId: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: GMAIL_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Extract the OAuth `code` from user input, tolerating a full redirect URL
 * (e.g. `http://localhost/?code=...&scope=...`) instead of just the raw code.
 */
export function extractGmailAuthorizationCode(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // If the user pasted a full redirect URL, pull out the `code` query param.
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
            const url = new URL(trimmed);
            const code = url.searchParams.get('code');
            if (code) return code;
        } catch {
            // Not a parseable URL; fall through to treating as raw code.
        }
    }

    // Otherwise treat the input as a raw code (strip trailing query/whitespace).
    return trimmed.split(/[&\s]/)[0];
}

function httpsRequestJson(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
    headers: Record<string, string> = {},
): Promise<any> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const hasExplicitContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
        const finalHeaders: Record<string, string> = { ...headers };
        if (payload !== undefined) {
            if (!hasExplicitContentType) {
                finalHeaders['Content-Type'] = 'application/json';
            }
            if (finalHeaders['Content-Length'] === undefined) {
                finalHeaders['Content-Length'] = String(Buffer.byteLength(payload));
            }
        }
        const options: https.RequestOptions = {
            method,
            headers: finalHeaders,
        };
        const req = https.request(parsed, options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsedBody: any;
                try { parsedBody = raw ? JSON.parse(raw) : {}; } catch { parsedBody = { raw }; }
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsedBody);
                } else {
                    reject(new Error(parsedBody?.error_description || parsedBody?.error?.message || parsedBody?.error || `HTTP ${res.statusCode}`));
                }
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Google request timed out.')));
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

export async function exchangeGmailCodeForTokens(clientId: string, clientSecret: string, code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        code: extractGmailAuthorizationCode(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });
    return {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        expires_at: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
    };
}

export async function refreshGmailAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });
    return {
        access_token: result.access_token,
        refresh_token: result.refresh_token || refreshToken,
        expires_at: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
    };
}

function base64UrlEncode(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function listMessages(accessToken: string, args: GmailToolArgs): Promise<GmailResult['messages']> {
    const maxResults = Math.max(1, Math.min(50, Math.floor(args.maxResults ?? 10)));
    const q = args.query ? `&q=${encodeURIComponent(args.query)}` : '';
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}${q}`;
    const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
    const items = result.messages ?? [];
    return items.map((item: any) => ({
        id: item.id ?? '',
        threadId: item.threadId ?? '',
        snippet: '',
        from: '',
        subject: '',
        date: '',
    }));
}

export async function runGmailTool(
    args: GmailToolArgs,
    getTokens: () => Promise<OAuthTokens | null>,
    getCredentials: () => Promise<{ clientId: string; clientSecret: string } | null>,
    saveTokens: (tokens: OAuthTokens) => Promise<void>,
): Promise<GmailResult> {
    const validation = validateGmailArgs(args as unknown as Record<string, unknown>);
    if (validation) {
        return { ok: false, message: validation };
    }

    // Mutations require confirmation — return a sentinel so the extension layer
    // can prompt the user before any send/reply.
    if (!isGmailReadOnly(args.action)) {
        return {
            ok: true,
            message: 'confirmation-required',
            needsConfirmation: true,
            pendingAction: args,
        };
    }

    const credentials = await getCredentials();
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        return { ok: false, message: 'Gmail is not configured. Provide Google OAuth credentials first.', needsAuthorization: true };
    }

    let tokens = await getTokens();
    if (!tokens || !tokens.access_token) {
        return { ok: false, message: 'Gmail authorization required.', needsAuthorization: true };
    }

    if (tokens.expires_at && tokens.expires_at <= Date.now() + 60000) {
        if (!tokens.refresh_token) {
            return { ok: false, message: 'Gmail token expired and cannot be refreshed. Re-authorize.', needsAuthorization: true };
        }
        try {
            tokens = await refreshGmailAccessToken(credentials.clientId, credentials.clientSecret, tokens.refresh_token);
            await saveTokens(tokens);
        } catch {
            return { ok: false, message: 'Failed to refresh Gmail token. Re-authorize.', needsAuthorization: true };
        }
    }

    try {
        if (args.action === 'list') {
            const messages = await listMessages(tokens.access_token, args);
            return {
                ok: true,
                message: messages && messages.length === 0 ? 'No messages found.' : `Found ${messages?.length ?? 0} message(s).`,
                messages,
            };
        }
        return { ok: false, message: 'Unsupported read action.' };
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Failed to read Gmail: ${detail}` };
    }
}

export async function runConfirmedGmailMutation(args: GmailToolArgs, tokens: OAuthTokens): Promise<GmailResult> {
    try {
        const to = args.to ?? '';
        const subject = args.subject ?? '';
        const body = args.body ?? '';
        const cc = args.cc;
        const bcc = args.bcc;
        const headers = [
            `To: ${to}`,
            ...(cc ? [`Cc: ${cc}`] : []),
            ...(bcc ? [`Bcc: ${bcc}`] : []),
            `Subject: ${subject}`,
            'Content-Type: text/plain; charset="UTF-8"',
            '',
            body,
        ].join('\r\n');
        const raw = base64UrlEncode(headers);
        const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
        await httpsRequestJson(url, 'POST', { raw }, { Authorization: `Bearer ${tokens.access_token}` });
        return { ok: true, message: 'Email sent.' };
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Gmail ${args.action} failed: ${detail}` };
    }
}
