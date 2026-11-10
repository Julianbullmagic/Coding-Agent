import * as vscode from 'vscode';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import {
    BUSINESS_TOKENS_SECRET,
    buildBusinessAuthorizationUrl,
    exchangeBusinessCodeForTokens,
    refreshBusinessAccessToken,
    normalizeTokens,
    isTokenExpired,
    findFirstLocation,
    listReviews,
    replyToReview,
    OAuthTokens as BusinessOAuthTokens,
    BusinessResult,
} from './business-reviews';
import {
    GMAIL_CLIENT_ID_SECRET,
    GMAIL_CLIENT_SECRET_SECRET,
} from './gmail';

const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';

interface ReviewWithDraft {
    name: string;
    rating: number;
    comment?: string;
    reviewer?: string;
    hasReply: boolean;
    reply?: string;
    createTime?: string;
    draftReply?: string;
}

/**
 * Draft a grateful reply based on the star rating.
 */
function draftReply(review: { rating: number; comment?: string; reviewer?: string }): string {
    const name = review.reviewerDisplayName || review.reviewer || 'there';
    const firstName = name.split(' ')[0] || name;
    const commentSnippet = review.comment ? ` We appreciate you taking the time to share your thoughts.` : '';

    switch (review.rating) {
        case 5:
            return `Thank you so much for the wonderful 5-star review, ${firstName}! We're thrilled you had such a great experience.${commentSnippet} We look forward to seeing you again!`;
        case 4:
            return `Thank you for the great review, ${firstName}! We're so glad you enjoyed your experience.${commentSnippet} We'd love to earn that 5th star next time!`;
        case 3:
            return `Thank you for your feedback, ${firstName}.${commentSnippet} We're glad you had a positive experience and we're always working to improve. We hope to exceed your expectations next time!`;
        case 2:
            return `Thank you for taking the time to share your feedback, ${firstName}. We're sorry your experience wasn't up to our usual standard. We'd love the chance to make it right — please don't hesitate to reach out to us directly.`;
        case 1:
            return `We're truly sorry to hear about your experience, ${firstName}. This is not the standard we hold ourselves to. We'd really appreciate the opportunity to make this right — please contact us directly so we can address your concerns.`;
        default:
            return `Thank you for your review, ${firstName}.${commentSnippet} We appreciate your feedback!`;
    }
}

function httpsRequestJson(url: string, method: 'GET' | 'POST' | 'PUT', body?: unknown, headers: Record<string, string> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const hasExplicitContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
        const finalHeaders: Record<string, string> = { ...headers };
        if (payload !== undefined) {
            if (!hasExplicitContentType) finalHeaders['Content-Type'] = 'application/json';
            if (finalHeaders['Content-Length'] === undefined) finalHeaders['Content-Length'] = String(Buffer.byteLength(payload));
        }
        const req = https.request(parsed, { method, headers: finalHeaders }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsedBody: any = null;
                if (raw) { try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; } }
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsedBody ?? { raw });
                    return;
                }
                const detail = (parsedBody && (parsedBody.error_description || parsedBody.error?.message || parsedBody.error)) || `HTTP ${res.statusCode}`;
                reject(new Error(typeof detail === 'string' ? detail : `HTTP ${res.statusCode}`));
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

/**
 * Run the auto-reply flow: authorize, list reviews, draft replies, optionally post them.
 */
export async function runBusinessAutoReply(context: vscode.ExtensionContext): Promise<void> {
    // Get credentials from SecretStorage (decrypted by VS Code)
    const clientId = await context.secrets.get(GMAIL_CLIENT_ID_SECRET);
    const clientSecret = await context.secrets.get(GMAIL_CLIENT_SECRET_SECRET);

    if (!clientId || !clientSecret) {
        void vscode.window.showErrorMessage('Google OAuth credentials not configured. Run "Coding Agent: Configure Google Calendar" first.');
        return;
    }

    // Get or authorize business tokens
    const readTokens = async (): Promise<BusinessOAuthTokens | null> => {
        const stored = context.globalState.get<unknown>(BUSINESS_TOKENS_SECRET);
        if (typeof stored === 'string') {
            try { return normalizeTokens(JSON.parse(stored)); } catch { return null; }
        }
        return normalizeTokens(stored);
    };

    const saveTokens = async (tokens: BusinessOAuthTokens): Promise<void> => {
        await context.globalState.update(BUSINESS_TOKENS_SECRET, tokens);
    };

    const authorize = async (): Promise<BusinessOAuthTokens> => {
        const authUrl = buildBusinessAuthorizationUrl(clientId);
        void vscode.window.showInformationMessage('Opening browser to authorize Google Business Profile. After allowing access, paste the code from the redirected URL.');
        await vscode.env.openExternal(vscode.Uri.parse(authUrl));
        const code = await vscode.window.showInputBox({
            prompt: 'Paste the authorization code from the browser after allowing access.',
            password: true,
            ignoreFocusOut: true,
        });
        if (!code) throw new Error('Authorization cancelled.');
        const exchanged = await exchangeBusinessCodeForTokens(clientId, clientSecret, code.trim());
        await saveTokens(exchanged);
        return exchanged;
    };

    let tokens = await readTokens();
    if (!tokens || !tokens.access_token) {
        tokens = await authorize();
    }

    if (isTokenExpired(tokens)) {
        if (tokens.refresh_token) {
            tokens = await refreshBusinessAccessToken(clientId, clientSecret, tokens.refresh_token);
            await saveTokens(tokens);
        } else {
            void vscode.window.showWarningMessage('Business Profile token expired. Re-authorizing...');
            tokens = await authorize();
        }
    }

    // Find business location
    const location = await findFirstLocation(tokens.access_token);
    if (!location) {
        void vscode.window.showErrorMessage('No Google Business Profile location found. Make sure your business is verified at business.google.com and the Business Profile APIs are enabled.');
        return;
    }

    void vscode.window.showInformationMessage(`Found business: ${location.title || location.name}. Loading reviews...`);

    // List reviews
    let result: BusinessResult;
    try {
        result = await listReviews(tokens.access_token, {
            action: 'list_reviews',
            location: location.name,
            pageSize: 50,
            orderBy: 'updateTime desc',
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        void vscode.window.showErrorMessage(`Failed to load reviews: ${detail}`);
        return;
    }

    if (!result.reviews || result.reviews.length === 0) {
        void vscode.window.showInformationMessage('No reviews found for your business.');
        return;
    }

    // Filter unanswered reviews and draft replies
    const unanswered = result.reviews.filter(r => !r.hasReply);
    const reviewsWithDrafts: ReviewWithDraft[] = result.reviews.map(r => ({
        ...r,
        draftReply: !r.hasReply ? draftReply(r) : undefined,
    }));

    // Show summary
    const totalReviews = result.reviews.length;
    const answered = totalReviews - unanswered.length;
    
    void vscode.window.showInformationMessage(
        `Found ${totalReviews} reviews (${answered} answered, ${unanswered.length} unanswered).`
    );

    // Save the review data to a file for inspection
    const outputPath = path.join(
        process.env.TEMP || process.env.TMP || 'C:/Users/admin/AppData/Local/Temp',
        'business-reviews.json'
    );
    fs.writeFileSync(outputPath, JSON.stringify({
        businessName: location.title || location.name,
        totalReviews,
        answered,
        unanswered: unanswered.length,
        reviews: reviewsWithDrafts,
    }, null, 2));

    // If there are no unanswered reviews, we're done
    if (unanswered.length === 0) {
        void vscode.window.showInformationMessage(
            `All ${totalReviews} reviews already have replies! Nothing to do.`
        );
        return;
    }

    // Ask the user what to do
    const choice = await vscode.window.showWarningMessage(
        `${unanswered.length} unanswered review(s) found. Draft grateful replies for all?`,
        { modal: true },
        'Reply to all',
        'Review each one',
        'Just save drafts'
    );

    if (!choice || choice === 'Just save drafts') {
        void vscode.window.showInformationMessage(`Review data with draft replies saved to: ${outputPath}`);
        return;
    }

    // Post replies
    let posted = 0;
    let errors = 0;

    if (choice === 'Reply to all') {
        for (const review of unanswered) {
            const replyText = draftReply(review);
            try {
                await replyToReview(tokens.access_token, review.name, replyText);
                posted++;
            } catch (error) {
                errors++;
                const detail = error instanceof Error ? error.message : 'Unknown error';
                console.error(`Failed to reply to ${review.name}: ${detail}`);
            }
        }
    } else {
        // Review each one
        for (const review of unanswered) {
            const replyText = draftReply(review);
            const stars = '⭐'.repeat(review.rating);
            const preview = [
                `${stars} from ${review.reviewer || 'Anonymous'}`,
                review.comment ? `"${review.comment.slice(0, 200)}"` : '(no comment)',
                '',
                'Draft reply:',
                replyText,
            ].join('\n');

            const action = await vscode.window.showWarningMessage(
                preview,
                { modal: true },
                'Post reply',
                'Skip',
                'Cancel all'
            );

            if (action === 'Post reply') {
                try {
                    await replyToReview(tokens.access_token, review.name, replyText);
                    posted++;
                } catch (error) {
                    errors++;
                }
            } else if (action === 'Cancel all') {
                break;
            }
        }
    }

    const message = errors > 0
        ? `Posted ${posted} repl${posted === 1 ? 'y' : 'ies'}, ${errors} failed.`
        : `Successfully posted ${posted} repl${posted === 1 ? 'y' : 'ies'}! 🎉`;
    void vscode.window.showInformationMessage(message);
}
