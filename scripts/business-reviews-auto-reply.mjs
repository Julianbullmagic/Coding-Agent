#!/usr/bin/env node

/**
 * Google Business Profile - Auto Reply to Unanswered Reviews
 * 
 * Standalone script that:
 * 1. Lists your Google Business reviews
 * 2. Identifies unanswered ones
 * 3. Drafts short grateful replies
 * 4. Asks for confirmation before posting each
 * 
 * Usage:
 *   node scripts/business-reviews-auto-reply.mjs
 * 
 * Requires environment variables:
 *   GOOGLE_CLIENT_ID     - Your OAuth Client ID
 *   GOOGLE_CLIENT_SECRET - Your OAuth Client Secret
 * 
 * Or pass them as arguments:
 *   node scripts/business-reviews-auto-reply.mjs CLIENT_ID CLIENT_SECRET
 * 
 * First run will open a browser for OAuth authorization.
 * Tokens are saved to ~/.google-business-tokens.json for reuse.
 */

import https from 'https';
import http from 'http';
import { open } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

// ─── Config ──────────────────────────────────────────────────────────
const BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const MYBUSINESS_BASE = 'https://mybusiness.googleapis.com/v4';
const TOKEN_FILE = path.join(os.homedir(), '.google-business-tokens.json');
const LOCAL_PORT = 9876; // Local redirect port for easier auth

// ─── Helpers ─────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

function httpsRequest(url, method, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
        const finalHeaders = { ...headers };
        if (payload !== undefined) {
            if (!Object.keys(finalHeaders).some(k => k.toLowerCase() === 'content-type')) {
                finalHeaders['Content-Type'] = 'application/json';
            }
        }
        const options = { method, headers: finalHeaders };
        const req = https.request(parsed, options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                let parsedBody = null;
                if (raw) { try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; } }
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(parsedBody ?? { raw });
                    return;
                }
                const detail = (parsedBody && (parsedBody.error?.message || parsedBody.error_description || parsedBody.error)) || `HTTP ${res.statusCode}: ${raw.slice(0, 300)}`;
                reject(new Error(typeof detail === 'string' ? detail : `HTTP ${res.statusCode}`));
            });
        });
        req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
        req.on('error', reject);
        if (payload !== undefined) req.write(payload);
        req.end();
    });
}

function loadTokens() {
    try {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    } catch { return null; }
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    console.log(`  💾 Tokens saved to ${TOKEN_FILE}`);
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
    console.log('  🔄 Refreshing access token...');
    const body = new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString();
    const result = await httpsRequest(TOKEN_ENDPOINT, 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (!result.refresh_token) result.refresh_token = refreshToken;
    const tokens = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + (result.expires_in || 3600) * 1000 };
    saveTokens(tokens);
    return tokens;
}

function isExpired(tokens) {
    return tokens.expires_at && tokens.expires_at <= Date.now() + 60000;
}

// ─── OAuth with local redirect ───────────────────────────────────────
async function authorize(clientId, clientSecret) {
    const redirectUri = `http://localhost:${LOCAL_PORT}`;
    
    const params = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri,
        response_type: 'code', scope: BUSINESS_SCOPE,
        access_type: 'offline', prompt: 'consent',
    });
    const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;
    
    console.log('\n🔑 Opening browser for Google Business Profile authorization...');
    console.log(`   If the browser doesn't open, visit this URL:\n   ${authUrl}\n`);
    
    // Try to open browser
    const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { require('child_process').exec(`${cmd} "${authUrl}"`); } catch {}
    
    // Start local server to catch the redirect
    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, redirectUri);
            const codeParam = url.searchParams.get('code');
            if (codeParam) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<h1>✅ Authorization successful! You can close this tab.</h1>');
                server.close();
                resolve(codeParam);
            } else {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<h1>❌ No authorization code received.</h1>');
                server.close();
                reject(new Error('No code in redirect'));
            }
        });
        server.listen(LOCAL_PORT, () => console.log(`  📡 Waiting for authorization callback on port ${LOCAL_PORT}...`));
        server.setTimeout(120000);
    });
    
    // Exchange code for tokens
    console.log('  🔄 Exchanging authorization code for tokens...');
    const body = new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
    }).toString();
    const result = await httpsRequest(TOKEN_ENDPOINT, 'POST', body, { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (!result.access_token) throw new Error('No access token received from Google.');
    
    const tokens = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + (result.expires_in || 3600) * 1000 };
    saveTokens(tokens);
    return tokens;
}

// ─── Business Profile API calls ─────────────────────────────────────
async function findFirstLocation(accessToken) {
    const params = new URLSearchParams({ readMask: 'name,title', pageSize: '1' });
    const url = `${BUSINESS_INFO_BASE}/accounts/-/locations?${params.toString()}`;
    const result = await httpsRequest(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
    const first = (result.locations ?? [])[0];
    if (!first) return null;
    return { name: first.name, title: first.title };
}

async function listAllReviews(accessToken, location, pageSize = 50) {
    const params = new URLSearchParams({ pageSize: String(pageSize), orderBy: 'updateTime desc' });
    const url = `${MYBUSINESS_BASE}/${location}/reviews?${params.toString()}`;
    const result = await httpsRequest(url, 'GET', undefined, { Authorization: `Bearer ${accessToken}` });
    
    const starMap = { FIVE: 5, FOUR: 4, THREE: 3, TWO: 2, ONE: 1 };
    return (result.reviews ?? []).map(r => ({
        name: r.name,
        rating: starMap[r.starRating] ?? 0,
        comment: r.comment,
        reviewer: r.reviewer?.displayName ?? 'Anonymous',
        hasReply: Boolean(r.reviewReply?.comment),
        reply: r.reviewReply?.comment,
        createTime: r.createTime,
    }));
}

async function replyToReview(accessToken, reviewName, comment) {
    const url = `${MYBUSINESS_BASE}/${reviewName}/reply`;
    return httpsRequest(url, 'PUT', { comment }, { Authorization: `Bearer ${accessToken}` });
}

// ─── Draft reply based on rating ─────────────────────────────────────
function draftReply(review) {
    const stars = review.rating;
    const name = review.reviewer && review.reviewer !== 'Anonymous' ? review.reviewer : '';
    const nameGreeting = name ? `, ${name}` : '';
    
    if (stars === 5) {
        const replies = [
            `Thank you so much${nameGreeting}! We're thrilled you had such a wonderful time. Your 5-star review means the world to us! 🎉`,
            `Wow, thank you${nameGreeting}! A 5-star review really made our day. So glad you enjoyed the experience! ✨`,
            `Thank you${nameGreeting}! We truly appreciate your kind words and fantastic rating. Hope to see you again! 🙏`,
        ];
        return replies[Math.floor(Math.random() * replies.length)];
    }
    if (stars === 4) {
        const replies = [
            `Thank you${nameGreeting}! Really glad you had a great experience. We appreciate the 4 stars and hope to make it 5 next time! 😊`,
            `Thanks so much${nameGreeting}! We're happy you enjoyed it and appreciate your feedback. Looking forward to welcoming you back! 🙏`,
        ];
        return replies[Math.floor(Math.random() * replies.length)];
    }
    if (stars === 3) {
        return `Thank you${nameGreeting} for your feedback. We appreciate you taking the time to share your experience and will use it to improve. We'd love the chance to exceed your expectations next time!`;
    }
    if (stars === 2) {
        return `Thank you${nameGreeting} for your honest feedback. We're sorry your experience wasn't up to par and we take this seriously. We'd appreciate the opportunity to make things right — please don't hesitate to reach out to us directly.`;
    }
    if (stars === 1) {
        return `We're truly sorry to hear about your experience${nameGreeting}. Your feedback is important to us and we want to make this right. Please contact us directly so we can address your concerns personally.`;
    }
    return `Thank you${nameGreeting} for your review! We appreciate your feedback.`;
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🎩 Google Business Profile — Auto Reply to Unanswered Reviews\n');
    
    // Get credentials
    let clientId = process.env.GOOGLE_CLIENT_ID || process.argv[2];
    let clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.argv[3];
    
    if (!clientId || !clientSecret) {
        console.log('⚠️  No credentials provided.\n');
        clientId = await ask('Enter your Google OAuth Client ID: ');
        clientSecret = await ask('Enter your Google OAuth Client Secret: ');
    }
    
    if (!clientId || !clientSecret) {
        console.error('❌ Client ID and Secret are required.');
        process.exit(1);
    }
    
    // Get or authorize tokens
    let tokens = loadTokens();
    if (!tokens || !tokens.access_token) {
        console.log('  📱 No saved tokens found. Starting authorization...');
        tokens = await authorize(clientId, clientSecret);
    } else if (isExpired(tokens)) {
        try {
            tokens = await refreshAccessToken(clientId, clientSecret, tokens.refresh_token);
        } catch {
            console.log('  ⚠️  Token refresh failed. Re-authorizing...');
            tokens = await authorize(clientId, clientSecret);
        }
    } else {
        console.log('  ✅ Using saved tokens.');
    }
    
    // Find business location
    console.log('\n🔍 Finding your business location...');
    let location;
    try {
        location = await findFirstLocation(tokens.access_token);
    } catch (e) {
        console.error(`❌ Error finding location: ${e.message}`);
        console.log('\n  This likely means:');
        console.log('  1. The "My Business Business Information API" is not enabled');
        console.log('  2. The "My Business Account Management API" is not enabled');
        console.log('  3. You don\'t have a verified Google Business Profile');
        console.log('\n  Enable APIs at: https://console.cloud.google.com/apis/library');
        process.exit(1);
    }
    
    if (!location) {
        console.error('❌ No Google Business Profile location found.');
        console.log('   Make sure you have a verified business at https://business.google.com');
        process.exit(1);
    }
    console.log(`  📍 Found: ${location.title} (${location.name})`);
    
    // List reviews
    console.log('\n📋 Fetching reviews...');
    let reviews;
    try {
        reviews = await listAllReviews(tokens.access_token, location.name, 50);
    } catch (e) {
        console.error(`❌ Error fetching reviews: ${e.message}`);
        console.log('\n  This likely means:');
        console.log('  1. The "Business Profile API" (v4 reviews) is not enabled');
        console.log('  2. The "My Business Account Management API" is not enabled');
        console.log('\n  Enable APIs at: https://console.cloud.google.com/apis/library');
        process.exit(1);
    }
    
    if (reviews.length === 0) {
        console.log('  No reviews found.');
        rl.close();
        return;
    }
    
    const unanswered = reviews.filter(r => !r.hasReply);
    const answered = reviews.filter(r => r.hasReply);
    
    console.log(`  📊 Total reviews: ${reviews.length}`);
    console.log(`  ✅ Already answered: ${answered.length}`);
    console.log(`  ⏳ Unanswered: ${unanswered.length}`);
    
    if (unanswered.length === 0) {
        console.log('\n  🎉 All reviews already have replies! Nothing to do.');
        rl.close();
        return;
    }
    
    // Display all reviews
    console.log('\n' + '─'.repeat(60));
    console.log('UNANSWERED REVIEWS:\n');
    for (const r of unanswered) {
        const stars = '⭐'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        const date = r.createTime ? new Date(r.createTime).toLocaleDateString() : 'Unknown date';
        console.log(`  ${stars}  by ${r.reviewer}  (${date})`);
        console.log(`  "${r.comment || '(no comment)'}"`);
        console.log(`  Review: ${r.name}`);
        console.log();
    }
    
    // Draft and confirm replies
    console.log('─'.repeat(60));
    console.log('DRAFTED REPLIES:\n');
    
    const toPost = [];
    for (const r of unanswered) {
        const reply = draftReply(r);
        const stars = '⭐'.repeat(r.rating);
        console.log(`  ${stars} ${r.reviewer}: "${(r.comment || '(no comment)').slice(0, 80)}${r.comment && r.comment.length > 80 ? '...' : ''}"`);
        console.log(`  → "${reply}"`);
        console.log();
        toPost.push({ review: r, reply });
    }
    
    // Ask for batch confirmation
    console.log('─'.repeat(60));
    const confirm = await ask(`\n  Post all ${toPost.length} replies? (yes/no/review-each): `);
    
    if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') {
        console.log(`\n  🚀 Posting ${toPost.length} replies...\n`);
        let posted = 0;
        for (const { review, reply } of toPost) {
            try {
                await replyToReview(tokens.access_token, review.name, reply);
                console.log(`  ✅ Replied to ${review.reviewer}'s ${review.rating}-star review`);
                posted++;
            } catch (e) {
                console.error(`  ❌ Failed to reply to ${review.name}: ${e.message}`);
            }
        }
        console.log(`\n  🎉 Posted ${posted}/${toPost.length} replies successfully!`);
    } else if (confirm.toLowerCase() === 'review-each' || confirm.toLowerCase() === 'r') {
        let posted = 0;
        let skipped = 0;
        for (const { review, reply } of toPost) {
            console.log(`\n  ${'⭐'.repeat(review.rating)} ${review.reviewer}: "${(review.comment || '(no comment)').slice(0, 100)}"`);
            console.log(`  Draft reply: "${reply}"`);
            const ans = await ask('  Post this reply? (yes/no/edit/skip-all): ');
            
            if (ans.toLowerCase() === 'skip-all' || ans.toLowerCase() === 's') {
                console.log('  ⏭️  Skipping remaining reviews.');
                break;
            } else if (ans.toLowerCase() === 'edit' || ans.toLowerCase() === 'e') {
                const edited = await ask('  Enter new reply: ');
                if (edited.trim()) {
                    try {
                        await replyToReview(tokens.access_token, review.name, edited.trim());
                        console.log('  ✅ Custom reply posted!');
                        posted++;
                    } catch (e) {
                        console.error(`  ❌ Failed: ${e.message}`);
                    }
                }
            } else if (ans.toLowerCase() === 'yes' || ans.toLowerCase() === 'y') {
                try {
                    await replyToReview(tokens.access_token, review.name, reply);
                    console.log('  ✅ Posted!');
                    posted++;
                } catch (e) {
                    console.error(`  ❌ Failed: ${e.message}`);
                }
            } else {
                console.log('  ⏭️  Skipped.');
                skipped++;
            }
        }
        console.log(`\n  📊 Posted: ${posted}, Skipped: ${skipped}`);
    } else {
        console.log('\n  ⏭️  No replies posted.');
    }
    
    rl.close();
    console.log('\n👋 Done!\n');
}

main().catch(e => {
    console.error(`\n❌ Fatal error: ${e.message}\n`);
    rl.close();
    process.exit(1);
});
