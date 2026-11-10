import * as https from 'https';
import * as vscode from 'vscode';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';

export const GOOGLE_CLIENT_ID_SECRET = 'codingAgent.googleClientId';
export const GOOGLE_CLIENT_SECRET_SECRET = 'codingAgent.googleClientSecret';
export const GOOGLE_TOKENS_SECRET = 'codingAgent.googleTokens';

interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
}

interface CalendarEvent {
    id?: string;
    summary?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    description?: string;
    location?: string;
}

export interface CalendarToolArgs {
    action: 'list' | 'create' | 'update' | 'delete';
    eventId?: string;
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
}

export interface CalendarResult {
    ok: boolean;
    message: string;
    events?: Array<{ id: string; summary: string; start: string; end: string; description?: string; location?: string }>;
    needsAuthorization?: boolean;
    needsConfirmation?: boolean;
    pendingAction?: CalendarToolArgs;
}

/**
 * Coerce a possibly-string `expires_in` (seconds) into a numeric value, or
 * return undefined when it is absent/non-numeric/zero.
 */
export function coerceExpiresIn(expiresIn: unknown): number | undefined {
    if (expiresIn === undefined || expiresIn === null) return undefined;
    const numeric = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return numeric;
}

/**
 * Nudge before expiry: tokens are treated as expired this many ms early so a
 * refresh happens before the access token actually becomes invalid.
 */
const EXPIRY_BUFFER_MS = 60000;

/**
 * Normalize a raw token payload (freshly exchanged, refreshed, or read back
 * from storage) into a well-formed {@link OAuthTokens} object, computing
 * `expires_at` from `expires_in` when only the latter is present.
 *
 * Returns null if the payload has no usable access token, so callers can treat
 * it as "not stored" instead of persisting a broken object.
 */
export function normalizeTokens(raw: unknown): OAuthTokens | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Record<string, unknown>;

    const accessToken = typeof candidate.access_token === 'string' ? candidate.access_token.trim() : '';
    if (!accessToken) return null;

    const refreshToken = typeof candidate.refresh_token === 'string' && candidate.refresh_token.trim()
        ? candidate.refresh_token.trim()
        : undefined;

    let expiresAt: number | undefined;
    if (typeof candidate.expires_at === 'number' && Number.isFinite(candidate.expires_at)) {
        expiresAt = candidate.expires_at;
    }
    if (expiresAt === undefined) {
        const expiresIn = coerceExpiresIn(candidate.expires_in);
        if (expiresIn !== undefined) {
            expiresAt = Date.now() + expiresIn * 1000;
        }
    }

    const tokens: OAuthTokens = { access_token: accessToken };
    if (refreshToken) tokens.refresh_token = refreshToken;
    if (expiresAt !== undefined) tokens.expires_at = expiresAt;
    return tokens;
}

/**
 * True when the token is known to be expired (or within the refresh buffer),
 * meaning it should be refreshed before use.
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
    // Without an expiry timestamp we optimistically assume it is still valid;
    // only explicit expiry forces a refresh.
    return typeof tokens.expires_at === 'number' && tokens.expires_at <= Date.now() + EXPIRY_BUFFER_MS;
}

/**
 * Parse and validate tool arguments for calendar operations.
 * Returns an error string if invalid, otherwise null.
 */
export function validateCalendarArgs(args: Record<string, unknown>): string | null {
    const action = args.action;
    if (typeof action !== 'string' || !['list', 'create', 'update', 'delete'].includes(action)) {
        return 'Invalid calendar action. Use one of: list, create, update, delete.';
    }
    if (action === 'list') {
        return null;
    }
    if (action === 'create') {
        if (typeof args.summary !== 'string' || !args.summary.trim()) {
            return 'A summary (event title) is required to create an event.';
        }
        if (typeof args.start !== 'string' || !args.start.trim()) {
            return 'A start time is required to create an event.';
        }
        if (typeof args.end !== 'string' || !args.end.trim()) {
            return 'An end time is required to create an event.';
        }
        if (isNaN(Date.parse(args.start)) || isNaN(Date.parse(args.end))) {
            return 'Start and end times must be valid ISO 8601 dates.';
        }
        if (Date.parse(args.start) >= Date.parse(args.end)) {
            return 'The event end time must be after the start time.';
        }
        return null;
    }
    if (action === 'update' || action === 'delete') {
        if (typeof args.eventId !== 'string' || !args.eventId.trim()) {
            return `An eventId is required to ${action} an event.`;
        }
        return null;
    }
    return null;
}

/**
 * Build a human-readable confirmation message for a mutation.
 */
export function buildConfirmationMessage(args: CalendarToolArgs): string {
    if (args.action === 'create') {
        const lines = [
            `Create calendar event:`,
            `  ${args.summary}`,
            `  ${args.start} → ${args.end}`,
        ];
        if (args.description) lines.push(`  Description: ${args.description}`);
        if (args.location) lines.push(`  Location: ${args.location}`);
        return lines.join('\n');
    }
    if (args.action === 'update') {
        const lines = [`Update calendar event ${args.eventId}:`];
        if (args.summary) lines.push(`  New title: ${args.summary}`);
        if (args.start && args.end) lines.push(`  New time: ${args.start} → ${args.end}`);
        else if (args.start) lines.push(`  New start: ${args.start}`);
        else if (args.end) lines.push(`  New end: ${args.end}`);
        if (args.description) lines.push(`  New description: ${args.description}`);
        if (args.location) lines.push(`  New location: ${args.location}`);
        return lines.join('\n');
    }
    return `Delete calendar event ${args.eventId}? This cannot be undone.`;
}

/**
 * Pure helper: decide whether an action is a read-only operation.
 */
export function isReadOnly(action: string): boolean {
    return action === 'list';
}

/**
 * Build the OAuth authorization URL (non-PKCE desktop loopback flow).
 */
export function buildAuthorizationUrl(clientId: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: CALENDAR_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Extract the OAuth `code` from user input, tolerating a full redirect URL,
 * a bare `code=...` fragment, a raw code, or a percent-encoded code.
 *
 * Google authorization codes look like `4/0Aea...` - note the `/`. In the
 * address bar after a redirect to http://localhost the `/` arrives
 * percent-encoded as `%2F` (e.g. `4%2F0Aea...`). This function therefore:
 *   1. pulls `code` out of any http(s) redirect URL (URLSearchParams
 *      already decodes `%2F` back to `/`),
 *   2. pulls `code` out of a bare `code=...&scope=...` fragment that lacks
 *      an explicit URL scheme,
 *   3. returns a lone token verbatim, percent-decoding it exactly once when
 *      it contains `%` sequences (so `4%2F0Aea...` becomes `4/0Aea...`),
 *   4. strips trailing whitespace/query noise defensively.
 *
 * It never truncates a legitimate code that contains `/`.
 */
export function extractAuthorizationCode(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';

    // Full redirect URL: pull the `code` query param (also decodes %2F -> /).
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            const code = url.searchParams.get('code');
            if (code) return code;
        } catch {
            // Not a parseable URL; fall through.
        }
    }

    // Bare "code=..." fragment without an explicit scheme (e.g. what a user
    // might copy out of a URL bar that dropped the scheme).
    const codeMatch = trimmed.match(/(?:^|[?&])code=([^&#\s]+)/);
    if (codeMatch) {
        const raw = codeMatch[1];
        return decodeOnce(raw);
    }

    // A lone token: percent-decode once if it contains "%" escape sequences,
    // otherwise return verbatim (so '4/0Aea...' with a literal slash survives).
    return decodeOnce(trimmed);
}

/** Percent-decode a code exactly once, falling back to verbatim on bad input. */
function decodeOnce(value: string): string {
    if (!value.includes('%')) return value;
    try {
        const decoded = decodeURIComponent(value);
        // A legitimate Google code keeps '/' and never round-trips to more %.
        if (!decoded.includes('%')) return decoded;
    } catch {
        // Malformed percent-encoding; use the raw value.
    }
    return value;
}

function httpsRequestJson(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, headers: Record<string, string> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        // Respect an explicitly provided Content-Type (needed for form-encoded
        // OAuth token requests) instead of always forcing application/json.
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
                // Prefer JSON, keep raw text as fallback so non-JSON errors
                // (e.g. a redirect page echoing an auth code) stay diagnosable.
                let parsedBody: any = null;
                if (raw) {
                    try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; }
                }
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsedBody ?? { raw });
                    return;
                }
                const detail =
                    (parsedBody && (parsedBody.error_description || parsedBody.error?.message || parsedBody.error)) ||
                    (raw && !raw.startsWith('{') ? raw.slice(0, 400) : undefined) ||
                    `HTTP ${res.statusCode}`;
                reject(new Error(typeof detail === 'string' ? detail : `HTTP ${res.statusCode}`));
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Google request timed out.')));
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

/**
 * Exchange an authorization code for tokens. Returns a normalized token object
 * (or throws if Google did not return a usable access token).
 */
export async function exchangeCodeForTokens(clientId: string, clientSecret: string, code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        code: extractAuthorizationCode(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });
    const tokens = normalizeTokens(result);
    if (!tokens) {
        throw new Error('Google did not return a valid access token. Check your OAuth Client ID and Secret.');
    }
    return tokens;
}

/**
 * Refresh an access token using a refresh token. Returns a normalized token
 * object, preserving the existing refresh token when Google does not echo a
 * new one.
 */
export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });
    // Google does not always return a refresh_token on refresh; keep the old one.
    if (!result.refresh_token) {
        result.refresh_token = refreshToken;
    }
    const tokens = normalizeTokens(result);
    if (!tokens) {
        throw new Error('Google did not return a valid access token while refreshing. Re-authorize.');
    }
    return tokens;
}

/**
 * Fetch calendar events (read-only).
 */
async function listEvents(accessToken: string, args: CalendarToolArgs): Promise<CalendarResult['events']> {
    const timeMin = args.timeMin || new Date().toISOString();
    const timeMax = args.timeMax;
    const maxResults = Math.max(1, Math.min(100, Math.floor(args.maxResults ?? 10)));
    const params = new URLSearchParams({
        timeMin,
        orderBy: 'startTime',
        singleEvents: 'true',
        maxResults: String(maxResults),
    });
    if (timeMax) params.set('timeMax', timeMax);
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
    const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
    return (result.items ?? []).map((item: any) => ({
        id: item.id ?? '',
        summary: item.summary ?? '(no title)',
        start: item.start?.dateTime || item.start?.date || '',
        end: item.end?.dateTime || item.end?.date || '',
        description: item.description,
        location: item.location,
    }));
}

/**
 * Create an event (mutation).
 */
async function createEvent(accessToken: string, args: CalendarToolArgs): Promise<void> {
    const event: CalendarEvent = {
        summary: args.summary,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
    };
    if (args.description) event.description = args.description;
    if (args.location) event.location = args.location;
    await httpsRequestJson(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        'POST',
        event,
        { Authorization: `Bearer ${accessToken}` },
    );
}

/**
 * Update an event (mutation).
 */
async function updateEvent(accessToken: string, args: CalendarToolArgs): Promise<void> {
    const patch: CalendarEvent = {};
    if (args.summary) patch.summary = args.summary;
    if (args.description) patch.description = args.description;
    if (args.location) patch.location = args.location;
    if (args.start) patch.start = { dateTime: args.start };
    if (args.end) patch.end = { dateTime: args.end };
    await httpsRequestJson(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.eventId!)}`,
        'PATCH',
        patch,
        { Authorization: `Bearer ${accessToken}` },
    );
}

/**
 * Delete an event (mutation).
 */
async function deleteEvent(accessToken: string, args: CalendarToolArgs): Promise<void> {
    await httpsRequestJson(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.eventId!)}`,
        'DELETE',
        undefined,
        { Authorization: `Bearer ${accessToken}` },
    );
}

/**
 * The core calendar tool execution, factored for testability.
 * Mutation actions return needsConfirmation=true and do NOT execute
 * until an explicit confirmation is provided (confirmation is handled
 * by the extension layer via a VS Code prompt).
 */
export async function runCalendarTool(
    args: CalendarToolArgs,
    getTokens: () => Promise<OAuthTokens | null>,
    getCredentials: () => Promise<{ clientId: string; clientSecret: string } | null>,
    saveTokens: (tokens: OAuthTokens) => Promise<void>,
    onAuthorize: (url: string) => Promise<string | undefined>,
): Promise<CalendarResult> {
    const mutatedArgs: Record<string, unknown> = { ...args };
    const validation = validateCalendarArgs(mutatedArgs);
    if (validation) {
        return { ok: false, message: validation };
    }

    // Mutations require confirmation before execution.
    if (!isReadOnly(args.action)) {
        return {
            ok: true,
            message: 'confirmation-required',
            needsConfirmation: true,
            pendingAction: args,
        };
    }

    // Read-only path (list) proceeds without confirmation.
    const credentials = await getCredentials();
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        return { ok: false, message: 'Google Calendar is not configured. Provide a Google OAuth Client ID and Secret first.', needsAuthorization: true };
    }

    let tokens = await getTokens();
    if (!tokens || !tokens.access_token) {
        return { ok: false, message: 'Google Calendar authorization required.', needsAuthorization: true };
    }

    if (isTokenExpired(tokens)) {
        if (!tokens.refresh_token) {
            return { ok: false, message: 'Google Calendar token expired and cannot be refreshed. Re-authorize.', needsAuthorization: true };
        }
        try {
            tokens = await refreshAccessToken(credentials.clientId, credentials.clientSecret, tokens.refresh_token);
            await saveTokens(tokens);
        } catch {
            return { ok: false, message: 'Failed to refresh Google Calendar token. Re-authorize.', needsAuthorization: true };
        }
    }

    try {
        const events = await listEvents(tokens.access_token, args);
        const safeEvents = events ?? [];
        return {
            ok: true,
            message: safeEvents.length === 0 ? 'No upcoming events found.' : `Found ${safeEvents.length} event(s).`,
            events: safeEvents,
        };
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Failed to read calendar: ${detail}` };
    }
}

/**
 * Execute a confirmed mutation.
 */
export async function runConfirmedMutation(
    args: CalendarToolArgs,
    tokens: OAuthTokens,
): Promise<CalendarResult> {
    try {
        if (args.action === 'create') {
            await createEvent(tokens.access_token, args);
            return { ok: true, message: `Created event "${args.summary}".` };
        }
        if (args.action === 'update') {
            await updateEvent(tokens.access_token, args);
            return { ok: true, message: `Updated event ${args.eventId}.` };
        }
        if (args.action === 'delete') {
            await deleteEvent(tokens.access_token, args);
            return { ok: true, message: `Deleted event ${args.eventId}.` };
        }
        return { ok: false, message: 'Unknown mutation action.' };
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Calendar ${args.action} failed: ${detail}` };
    }
}
