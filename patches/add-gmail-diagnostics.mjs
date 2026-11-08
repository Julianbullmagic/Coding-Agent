import { readFileSync, writeFileSync } from 'node:fs';

// Add diagnostics to createGmailHandler so failures are visible to the user
// instead of being silently swallowed by the model loop.
const file = 'src/extension.ts';
const source = readFileSync(file, 'utf8');

// 1. Replace the credential-missing early return with a visible error + popup.
const oldCredentialCheck = `        if (!credentials.clientId || !credentials.clientSecret) {
            return JSON.stringify({ error: 'Gmail is not configured. Run "Coding Agent: Configure Google Calendar" to provide Google OAuth credentials.' });
        }`;

const newCredentialCheck = `        if (!credentials.clientId || !credentials.clientSecret) {
            const message = 'Gmail is not configured. Run "Coding Agent: Configure Google Calendar" (Ctrl+Shift+P), paste your Desktop-app Client ID and Secret, then reload.';
            void vscode.window.showErrorMessage(message);
            return JSON.stringify({ error: message });
        }`;

if (!source.includes(oldCredentialCheck)) {
    throw new Error('FAILED: credential-missing block not found. Aborting to avoid a partial edit.');
}

// 2. Add a popup right before opening the browser so the user can see the auth is actually starting.
const oldAuthorizeOpen = `            const authUrl = buildGmailAuthorizationUrl(credentials.clientId);
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));`;

const newAuthorizeOpen = `            const authUrl = buildGmailAuthorizationUrl(credentials.clientId);
            void vscode.window.showInformationMessage('Opening browser to authorize Gmail. After allowing access, paste the code from the redirected URL.');
            await vscode.env.openExternal(vscode.Uri.parse(authUrl));`;

if (!source.includes(oldAuthorizeOpen)) {
    throw new Error('FAILED: authorize open block not found. Aborting to avoid a partial edit.');
}

// 3. Surface code-exchange / token errors as visible popups in the read-only retry path.
const oldCatch = `            } catch (error) {
                const detail = error instanceof Error ? error.message : 'Unknown error';
                return JSON.stringify({ ok: false, message: \`Gmail authorization failed: \${detail}\` });
            }`;

const newCatch = `            } catch (error) {
                const detail = error instanceof Error ? error.message : 'Unknown error';
                const message = \`Gmail authorization failed: \${detail}\`;
                void vscode.window.showErrorMessage(message);
                return JSON.stringify({ ok: false, message });
            }`;

if (!source.includes(oldCatch)) {
    throw new Error('FAILED: read-only catch block not found. Aborting to avoid a partial edit.');
}

// 4. Surface send-time failures as a visible popup and include the scope hint.
const oldMutationError = `        if (!tokens.access_token) {
            return JSON.stringify({ error: 'Gmail is not authorized yet.' });
        }

        const result = await runConfirmedGmailMutation(args, tokens);
        return JSON.stringify(result);`;

const newMutationError = `        if (!tokens.access_token) {
            const message = 'Gmail is not authorized yet.';
            void vscode.window.showErrorMessage(message);
            return JSON.stringify({ error: message });
        }

        const result = await runConfirmedGmailMutation(args, tokens);
        if (!result.ok) {
            void vscode.window.showErrorMessage(result.message);
        }
        return JSON.stringify(result);`;

if (!source.includes(oldMutationError)) {
    throw new Error('FAILED: mutation error block not found. Aborting to avoid a partial edit.');
}

// 5. Make the Configure Google Calendar success message clearly state Gmail is included.
const oldConfigMessage = `        void vscode.window.showInformationMessage('Google Calendar credentials saved. The agent will prompt for authorization on first use.');`;

const newConfigMessage = `        void vscode.window.showInformationMessage('Google OAuth credentials saved for Calendar and Gmail. Reload the window, then the browser will open to authorize on first email/calendar use.');`;

if (!source.includes(oldConfigMessage)) {
    throw new Error('FAILED: config success message not found. Aborting to avoid a partial edit.');
}

const out = source
    .replace(oldCredentialCheck, newCredentialCheck)
    .replace(oldAuthorizeOpen, newAuthorizeOpen)
    .replace(oldCatch, newCatch)
    .replace(oldMutationError, newMutationError)
    .replace(oldConfigMessage, newConfigMessage);

writeFileSync(file, out, 'utf8');
console.log('Patched extension.ts with Gmail diagnostics (5 replacements applied).');
