import * as https from 'https';

const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';

// Secrets/keys shared with the configureGoogleCalendar command (same client).
export const BUSINESS_CLIENT_ID_SECRET = 'codingAgent.googleClientId';
export const BUSINESS_CLIENT_SECRET_SECRET = 'codingAgent.googleClientSecret';
export const BUSINESS_TOKENS_SECRET = 'codingAgent.businessTokens';

const BUSINESS_INFORMATION_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';

export interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
}

export interface BusinessReview {
    name: string;
    rating: number;
    comment?: string;
    reviewerDisplayName?: string;
    reviewerProfilePhoto?: string;
    reviewerReply?: { comment: string; updateTime: string };
    createTime?: string;
    updateTime?: string;
}

export interface BusinessLocation {
    name: string;
    title?: string;
}

export interface BusinessToolArgs {
    action: 'list_reviews' | 'reply_review';
    location?: string;            // Optional location name, e.g. "accounts/123/locations/456". Defaults to first accessible location.
    reviewName?: string;          // Full review name for reply_review.
    pageSize?: number;
    orderBy?: string;
    replyComment?: string;        // The reply text for reply_review.
}

export interface BusinessResult {
    ok: boolean;
    message: string;
    reviews?: Array<{
        name: string;
        rating: number;
        comment?: string;
        reviewer?: string;
        hasReply: boolean;
        reply?: string;
        createTime?: string;
    }>;
    location?: { name: string; title?: string };
    needsAuthorization?: boolean;
    needsConfirmation?: boolean;
    pendingAction?: BusinessToolArgs;
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

const EXPIRY_BUFFER_MS = 60000;

/**
 * Normalize a raw token payload into a well-formed OAuthTokens object.
 * Returns null if the payload has no usable access token.
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

export function isTokenExpired(tokens: OAuthTokens): boolean {
    return typeof tokens.expires_at === 'number' && tokens.expires_at <= Date.now() + EXPIRY_BUFFER_MS;
}

/**
 * Validate tool arguments for Business Profile operations.
 */
export function validateBusinessArgs(args: Record<string, unknown>): string | null {
    const action = args.action;
    if (typeof action !== 'string' || !['list_reviews', 'reply_review'].includes(action)) {
        return 'Invalid business action. Use one of: list_reviews, reply_review.';
    }
    if (action === 'list_reviews') {
        if (args.pageSize !== undefined && (typeof args.pageSize !== 'number' || !Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 50)) {
            return 'pageSize must be an integer between 1 and 50.';
        }
        if (args.orderBy !== undefined && typeof args.orderBy !== 'string') {
            return 'orderBy must be a string (rating, rating desc, or updateTime desc).';
        }
        return null;
    }
    // reply_review
    if (typeof args.reviewName !== 'string' || !args.reviewName.trim()) {
        return 'A reviewName (e.g. accounts/*/locations/*/reviews/*) is required to reply to a review.';
    }
    if (typeof args.replyComment !== 'string' || !args.replyComment.trim()) {
        return 'A replyComment is required to reply to a review.';
    }
    if (args.replyComment.length > 4096) {
        return 'Reply comment exceeds the 4096-character Google Business Profile limit.';
    }
    return null;
}

export function isBusinessReadOnly(action: string): boolean {
    return action === 'list_reviews';
}

export function buildBusinessAuthorizationUrl(clientId: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: BUSINESS_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export function extractBusinessAuthorizationCode(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return '';

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            const code = url.searchParams.get('code');
            if (code) return code;
        } catch {
            // Not a parseable URL; fall through.
        }
    }

    const codeMatch = trimmed.match(/(?:^|[?&])code=([^&#\s]+)/);
    if (codeMatch) {
        return decodeOnce(codeMatch[1]);
    }

    return decodeOnce(trimmed);
}

function decodeOnce(value: string): string {
    if (!value.includes('%')) return value;
    try {
        const decoded = decodeURIComponent(value);
        if (!decoded.includes('%')) return decoded;
    } catch {
        // Malformed percent-encoding; use the raw value.
    }
    return value;
}

function httpsRequestJson(url: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, headers: Record<string, string> = {}): Promise<any> {
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

export async function exchangeBusinessCodeForTokens(clientId: string, clientSecret: string, code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        code: extractBusinessAuthorizationCode(code),
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

export async function refreshBusinessAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, {
        'Content-Type': 'application/x-www-form-urlencoded',
    });
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
 * List the first accessible business location for the authenticated user.
 * Uses the Business Information API (v1) with a wildcard account.
 */
export async function findFirstLocation(accessToken: string): Promise<BusinessLocation | null> {
    const params = new URLSearchParams({
        readMask: 'name,title',
        pageSize: '1',
    });
    const url = `${BUSINESS_INFORMATION_BASE}/accounts/-/locations?${params.toString()}`;
    const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
    const first = (result.locations ?? [])[0];
    if (!first) return null;
    return { name: first.name ?? '', title: first.title ?? undefined };
}

/**
 * List reviews for a location (read-only).
 */
export async function listReviews(accessToken: string, args: BusinessToolArgs): Promise<BusinessResult> {
    const location = args.location?.trim() || (await findFirstLocation(accessToken))?.name;
    if (!location) {
        return {
            ok: false,
            message: 'No Google Business Profile location found for this account. Verify your business is set up and verified.',
        };
    }

    const maxResults = Math.max(1, Math.min(50, Math.floor(args.pageSize ?? 20)));
    const params = new URLSearchParams({ pageSize: String(maxResults) });
    if (args.orderBy) params.set('orderBy', args.orderBy);
    const url = `${MYBUSINESS_BASE}/${location}/reviews?${params.toString()}`;
    const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });

    const reviews: NonNullable<BusinessResult['reviews']> = (result.reviews ?? []).map((review: any) => ({
        name: review.name ?? '',
        rating: review.starRating === 'FIVE' ? 5 : review.starRating === 'FOUR' ? 4 : review.starRating === 'THREE' ? 3 : review.starRating === 'TWO' ? 2 : review.starRating === 'ONE' ? 1 : 0,
        comment: review.comment,
        reviewer: review.reviewer?.displayName,
        hasReply: Boolean(review.reviewReply?.comment),
        reply: review.reviewReply?.comment,
        createTime: review.createTime,
    }));

    return {
        ok: true,
        message: reviews.length === 0
            ? `No reviews found for ${location}.`
            : `Found ${reviews.length} review(s) for ${location} (average rating: ${result.averageRating ?? 'n/a'}, total: ${result.totalReviewCount ?? 'n/a'}).`,
        location: { name: location },
        reviews,
    };
}

/**
 * Reply to a review (mutation). Uses the updateReply PUT endpoint which
 * creates a reply if none exists, or updates the existing one.
 */
export async function replyToReview(accessToken: string, reviewName: string, comment: string): Promise<BusinessResult> {
    const url = `${MYBUSINESS_BASE}/${reviewName}/reply`;
    const result = await httpsRequestJson(url, 'PUT', { comment }, { Authorization: `Bearer ${accessToken}` });
    return {
        ok: true,
        message: `Reply posted to ${reviewName}.`,
        location: undefined,
        reviews: undefined,
    };
}

/**
 * Build a human-readable confirmation message for a review reply mutation.
 */
export function buildBusinessConfirmationMessage(args: BusinessToolArgs): string {
    const preview = args.replyComment && args.replyComment.length > 300
        ? args.replyComment.slice(0, 300) + '...'
        : args.replyComment;
    return [
        `Reply to Google Business review:`,
        `  Review: ${args.reviewName}`,
        `  Reply: ${preview ?? '(empty)'}`,
    ].join('\n');
}

/**
 * The core Business Profile tool execution, factored for testability.
 * reply_review requires confirmation before execution (handled by the
 * extension layer via a VS Code modal prompt).
 */
export async function runBusinessTool(
    args: BusinessToolArgs,
    getTokens: () => Promise<OAuthTokens | null>,
    getCredentials: () => Promise<{ clientId: string; clientSecret: string } | null>,
    saveTokens: (tokens: OAuthTokens) => Promise<void>,
    onAuthorize: (url: string) => Promise<string | undefined>,
): Promise<BusinessResult> {
    const mutatedArgs: Record<string, unknown> = { ...args };
    const validation = validateBusinessArgs(mutatedArgs);
    if (validation) {
        return { ok: false, message: validation };
    }

    if (!isBusinessReadOnly(args.action)) {
        return {
            ok: true,
            message: 'confirmation-required',
            needsConfirmation: true,
            pendingAction: args,
        };
    }

    // Read-only path (list_reviews) proceeds without confirmation.
    const credentials = await getCredentials();
    if (!credentials || !credentials.clientId || !credentials.clientSecret) {
        return { ok: false, message: 'Google Business Profile is not configured. Provide a Google OAuth Client ID and Secret first.', needsAuthorization: true };
    }

    let tokens = await getTokens();
    if (!tokens || !tokens.access_token) {
        return { ok: false, message: 'Google Business Profile authorization required.', needsAuthorization: true };
    }

    if (isTokenExpired(tokens)) {
        if (!tokens.refresh_token) {
            return { ok: false, message: 'Google Business Profile token expired and cannot be refreshed. Re-authorize.', needsAuthorization: true };
        }
        try {
            tokens = await refreshBusinessAccessToken(credentials.clientId, credentials.clientSecret, tokens.refresh_token);
            await saveTokens(tokens);
        } catch {
            return { ok: false, message: 'Failed to refresh Google Business Profile token. Re-authorize.', needsAuthorization: true };
        }
    }

    try {
        return await listReviews(tokens.access_token, args);
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Failed to read business reviews: ${detail}` };
    }
}

/**
 * Execute a confirmed mutation.
 */
export async function runConfirmedBusinessMutation(
    args: BusinessToolArgs,
    tokens: OAuthTokens,
): Promise<BusinessResult> {
    try {
        if (args.action === 'reply_review') {
            return await replyToReview(tokens.access_token, args.reviewName!, args.replyComment!);
        }
        return { ok: false, message: 'Unknown mutation action.' };
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return { ok: false, message: `Business reply failed: ${detail}` };
    }
}
