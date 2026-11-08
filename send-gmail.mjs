// Standalone Gmail sender — reuses the corrected OAuth logic from src/gmail.ts.
//
// Usage:
//   1. Set your Google OAuth Desktop-app Client ID and Secret as env vars:
//        set GMAIL_CLIENT_ID=xxxx.apps.googleusercontent.com
//        set GMAIL_CLIENT_SECRET=GOCSPX-xxxx
//   2. Run:  node send-gmail.mjs
//   3. It prints an authorization URL. Open it in a browser, approve, and you'll be
//      redirected to http://localhost/?code=...  (the "refusing to connect" page is expected).
//      Copy the ENTIRE value after "code=" (not the whole URL), paste it when prompted.
//   4. The script exchanges the code, sends the email, and caches the refresh token
//      to .gmail-tokens.json so future runs don't require re-authorization.

import * as https from 'https';
import * as fs from 'fs';
import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REDIRECT_URI = 'http://localhost';
const TOKENS_FILE = path.join(os.homedir(), '.gmail-tokens.json');

const TO = process.argv[2] || 'julianbullmagic@gmail.com';
const SUBJECT = process.argv[3] || 'Test email from Coding Agent';
const BODY = process.argv[4] || 'This is a test email to verify Gmail works.';

function fail(msg) {
  console.error('\n' + msg);
  process.exit(1);
}

function readCredential(name, envName) {
  const v = process.env[envName];
  if (!v || !v.trim()) {
    fail(`${name} is missing. Set the env var ${envName} first.\n` +
      `  Windows: set ${envName}=your-value\n` +
      `  Or define GMAIL_CREDENTIALS as JSON: {"clientId":"...","clientSecret":"..."}`);
  }
  return v.trim();
}

function getCredentials() {
  const json = process.env.GMAIL_CREDENTIALS;
  if (json && json.trim()) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.clientId && parsed.clientSecret) return parsed;
    } catch {
      fail('GMAIL_CREDENTIALS is not valid JSON.');
    }
  }
  return {
    clientId: readCredential('Client ID', 'GMAIL_CLIENT_ID'),
    clientSecret: readCredential('Client Secret', 'GMAIL_CLIENT_SECRET'),
  };
}

function httpsRequestJson(url, method, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    const finalHeaders = { ...headers };
    if (payload !== undefined) {
      if (!hasContentType) finalHeaders['Content-Type'] = 'application/json';
      finalHeaders['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = https.request(parsed, { method, headers: finalHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsedBody;
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

function buildAuthorizationUrl(clientId) {
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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function exchangeCode(clientId, clientSecret, code) {
  const body = new URLSearchParams({
    code,
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

async function refreshToken(clientId, clientSecret, refreshToken) {
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

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail(accessToken, to, subject, body) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');
  const raw = base64UrlEncode(headers);
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  await httpsRequestJson(url, 'POST', { raw }, { Authorization: `Bearer ${accessToken}` });
}

async function main() {
  const { clientId, clientSecret } = getCredentials();

  let tokens = null;
  if (fs.existsSync(TOKENS_FILE)) {
    try {
      tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    } catch {}
  }

  // Refresh if we have a cached refresh token.
  if (tokens && tokens.refresh_token) {
    try {
      tokens = await refreshToken(clientId, clientSecret, tokens.refresh_token);
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    } catch (e) {
      console.error('Refresh failed:', e.message, '\n');
      tokens = null;
    }
  }

  // Otherwise do the full authorization-code flow.
  if (!tokens || !tokens.access_token) {
    const authUrl = buildAuthorizationUrl(clientId);
    console.log('Open this URL in your browser and approve access:\n');
    console.log(authUrl + '\n');
    console.log('You will be redirected to http://localhost/?code=... (the connection error there is expected).\n');
    const input = await ask('Paste ONLY the value after "code=" (or the full redirect URL): ');
    const code = input.trim();
    tokens = await exchangeCode(clientId, clientSecret, code);
    if (tokens.refresh_token) {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    }
  }

  await sendEmail(tokens.access_token, TO, SUBJECT, BODY);
  console.log(`\n✅ Email sent to ${TO}`);
  rl.close();
}

main().catch((e) => {
  console.error('\n❌ Failed:', e.message);
  rl.close();
  process.exit(1);
});
