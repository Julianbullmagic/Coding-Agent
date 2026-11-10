/**
 * Standalone script to list Google Business Profile reviews.
 * Uses the same OAuth credentials as the extension but requests the business.manage scope.
 * 
 * Usage: node scripts/list-reviews.js
 * 
 * It will:
 * 1. Read credentials from VS Code SecretStorage (via the state DB or env vars)
 * 2. If BUSINESS_ACCESS_TOKEN env var is set, use it directly
 * 3. Otherwise, open a browser for OAuth authorization
 */

const https = require('https');

const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';
const BUSINESS_INFORMATION_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';

function httpsRequestJson(url, method, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const hasExplicitContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
        const finalHeaders = { ...headers };
        if (payload !== undefined) {
            if (!hasExplicitContentType) finalHeaders['Content-Type'] = 'application/json';
            if (finalHeaders['Content-Length'] === undefined) finalHeaders['Content-Length'] = String(Buffer.byteLength(payload));
        }
        const options = { method, headers: finalHeaders };
        const req = https.request(parsed, options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsedBody = null;
                if (raw) { try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; } }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsedBody ?? { raw });
                    return;
                }
                const detail = (parsedBody && (parsedBody.error_description || parsedBody.error?.message || parsedBody.error)) || (raw && !raw.startsWith('{') ? raw.slice(0, 400) : undefined) || `HTTP ${res.statusCode}`;
                reject(new Error(typeof detail === 'string' ? detail : `HTTP ${res.statusCode}`));
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

async function exchangeCodeForTokens(clientId, clientSecret, code) {
    const body = new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
    return result;
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
    const body = new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString();
    const result = await httpsRequestJson(TOKEN_ENDPOINT, 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (!result.refresh_token) result.refresh_token = refreshToken;
    return result;
}

async function findFirstLocation(accessToken) {
    const params = new URLSearchParams({ readMask: 'name,title', pageSize: '10' });
    const url = `${BUSINESS_INFORMATION_BASE}/accounts/-/locations?${params.toString()}`;
    try {
        const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
        return result.locations ?? [];
    } catch (err) {
        console.error('Error finding locations:', err.message);
        return [];
    }
}

async function listReviews(accessToken, locationName, pageSize = 50) {
    const params = new URLSearchParams({ pageSize: String(pageSize), orderBy: 'updateTime desc' });
    const url = `${MYBUSINESS_BASE}/${locationName}/reviews?${params.toString()}`;
    try {
        const result = await httpsRequestJson(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
        return result;
    } catch (err) {
        console.error('Error listing reviews:', err.message);
        return { reviews: [] };
    }
}

async function replyToReview(accessToken, reviewName, comment) {
    const url = `${MYBUSINESS_BASE}/${reviewName}/reply`;
    const result = await httpsRequestJson(url, 'PUT', { comment }, { Authorization: `Bearer ${accessToken}` });
    return result;
}

function generateReply(review) {
    const name = review.reviewer?.displayName ? `${review.reviewer.displayName} ` : '';
    const rating = review.starRating;
    
    if (rating === 'FIVE' || rating === 'FOUR') {
        const templates = [
            `Thank you ${name}for the wonderful review! We're so glad you enjoyed the show and appreciate you taking the time to share your experience.`,
            `Thanks ${name}for your kind words! It was a pleasure performing for you. We hope to see you at another show soon!`,
            `We really appreciate your fantastic review ${name}! Thrilled you had a great time — thanks for coming along!`,
        ];
        return templates[Math.floor(Math.random() * templates.length)];
    }
    if (rating === 'THREE') {
        return `Thank you ${name}for your feedback. We appreciate you sharing your experience and we're always looking to improve. Hope to see you again!`;
    }
    // ONE or TWO
    return `Thank you ${name}for your feedback. We're sorry to hear your experience wasn't what you hoped for. We'd love the opportunity to make it right — please don't hesitate to reach out to us directly.`;
}

async function main() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const accessToken = process.env.BUSINESS_ACCESS_TOKEN;
    const refreshToken = process.env.BUSINESS_REFRESH_TOKEN;
    const dryRun = process.env.DRY_RUN !== 'false'; // default to dry run

    if (!clientId || !clientSecret) {
        console.error('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
        console.error('You can find these in your VS Code extension settings (Configure Google Calendar command).');
        console.error('');
        console.error('Optionally set BUSINESS_ACCESS_TOKEN and BUSINESS_REFRESH_TOKEN if you already have them.');
        process.exit(1);
    }

    let token;
    if (accessToken) {
        token = { access_token: accessToken, refresh_token: refreshToken };
        console.log('Using provided access token.');
    } else {
        // Need to authorize
        const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
            client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
            scope: BUSINESS_SCOPE, access_type: 'offline', prompt: 'consent',
        }).toString()}`;
        
        console.log('\n📋 No Business Profile access token found.');
        console.log('Opening browser for authorization...\n');
        console.log('👉 Open this URL in your browser:\n');
        console.log(authUrl);
        console.log('\nAfter authorizing, you\'ll be redirected to http://localhost?code=...');
        console.log('Copy the full URL from the address bar and set it as BUSINESS_AUTH_CODE env var.\n');
        
        const authCode = process.env.BUSINESS_AUTH_CODE;
        if (!authCode) {
            console.error('Set BUSINESS_AUTH_CODE env var with the authorization code from the redirect URL, then run again.');
            process.exit(1);
        }
        
        // Extract code from URL if needed
        let code = authCode;
        try {
            const url = new URL(authCode);
            if (url.searchParams.get('code')) code = url.searchParams.get('code');
        } catch {}
        
        const tokens = await exchangeCodeForTokens(clientId, clientSecret, code);
        token = tokens;
        console.log('\n✅ Authorization successful!');
        console.log('Save these for next time:');
        console.log(`  BUSINESS_ACCESS_TOKEN=${tokens.access_token}`);
        console.log(`  BUSINESS_REFRESH_TOKEN=${tokens.refresh_token}`);
    }

    // Refresh if needed
    if (token.expires_at && token.expires_at <= Date.now() + 60000 && token.refresh_token) {
        console.log('Token expired, refreshing...');
        token = await refreshAccessToken(clientId, clientSecret, token.refresh_token);
    }

    // Find locations
    console.log('\n🔍 Looking for business locations...');
    const locations = await findFirstLocation(token.access_token);
    
    if (!locations.length) {
        console.error('❌ No Google Business Profile locations found.');
        console.error('Make sure:');
        console.error('  1. You have a verified business at https://business.google.com');
        console.error('  2. The Business Profile API is enabled in Google Cloud Console');
        console.error('  3. The My Business Account Management API is enabled');
        process.exit(1);
    }

    console.log(`\n📍 Found ${locations.length} location(s):`);
    locations.forEach(loc => console.log(`   - ${loc.title || loc.name}`));

    // Process first location (or all)
    for (const location of locations) {
        console.log(`\n⭐ Fetching reviews for: ${location.title || location.name}`);
        const result = await listReviews(token.access_token, location.name, 50);
        const reviews = result.reviews ?? [];
        
        console.log(`   Total: ${result.totalReviewCount ?? reviews.length}, Average rating: ${result.averageRating ?? 'n/a'}`);
        
        const unanswered = reviews.filter(r => !r.reviewReply?.comment);
        console.log(`   Unanswered: ${unanswered.length}`);
        
        if (!unanswered.length) {
            console.log('   ✅ All reviews have replies!');
            continue;
        }

        console.log('\n   Unanswered reviews:');
        console.log('   ' + '─'.repeat(60));
        
        for (const review of unanswered) {
            const starMap = { ONE: '⭐', TWO: '⭐⭐', THREE: '⭐⭐⭐', FOUR: '⭐⭐⭐⭐', FIVE: '⭐⭐⭐⭐⭐' };
            const stars = starMap[review.starRating] || review.starRating;
            const reviewer = review.reviewer?.displayName || 'Anonymous';
            const comment = review.comment ? (review.comment.length > 100 ? review.comment.slice(0, 100) + '...' : review.comment) : '(no comment)';
            
            console.log(`\n   📝 ${reviewer} — ${stars}`);
            console.log(`   "${comment}"`);
            console.log(`   Review ID: ${review.name}`);
            
            const reply = generateReply(review);
            console.log(`   💬 Proposed reply: "${reply}"`);
            
            if (dryRun) {
                console.log('   ⏸️  [DRY RUN] Set DRY_RUN=false to actually post replies.');
            } else {
                try {
                    await replyToReview(token.access_token, review.name, reply);
                    console.log('   ✅ Reply posted!');
                } catch (err) {
                    console.error(`   ❌ Failed to post reply: ${err.message}`);
                }
            }
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
