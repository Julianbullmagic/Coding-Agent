import { readFileSync, writeFileSync } from 'fs';

const file = 'src/agent.ts';
let text = readFileSync(file, 'utf8');

const before = `            } else if (name === 'fetch_page' && typeof args.url === 'string') {
                if (provider === 'glm') {
                    return await fetchPageDirect(args.url);
                }
                return await fetchPageDeepSeek(apiKey, args.url);`;

const after = `            } else if (name === 'fetch_page' && typeof args.url === 'string') {
                if (provider === 'glm') {
                    return await fetchPageDirect(args.url);
                }
                try {
                    return await fetchPageDeepSeek(apiKey, args.url);
                } catch (hostedError) {
                    // Fall back to direct fetching when the hosted endpoint
                    // is unavailable or the request fails.
                    try {
                        return await fetchPageDirect(args.url);
                    } catch {
                        throw hostedError;
                    }
                }`;

if (!text.includes(before)) {
    console.error('Pattern not found — aborting without changes.');
    process.exit(1);
}
text = text.replace(before, after);
writeFileSync(file, text);
console.log('Patched fetch_page fallback in src/agent.ts');
