/**
 * Extract a raw filesystem path from VS Code's startup arguments.
 *
 * Pure, dependency-free so it can be unit-tested without the `vscode` module.
 * Examples handled:
 *   code --folder-uri file:///home/user/project
 *   code --folder-uri=file:///c:/path
 *   code -folder-uri file:///c:/path
 */
export function startupFolderPath(argv: string[] = process.argv): string | undefined {
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--folder-uri' || arg === '-folder-uri') {
            const raw = argv[index + 1];
            if (raw) return pathFromFolderUri(raw);
        }
        if (arg.startsWith('--folder-uri=')) {
            return pathFromFolderUri(arg.slice('--folder-uri='.length));
        }
    }
    return undefined;
}

function pathFromFolderUri(raw: string): string | undefined {
    try {
        const decoded = decodeURIComponent(raw.replace(/^file:\/\//, ''));
        // On Windows a file URI looks like "file:///c:/path"; strip the leading slash.
        if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(decoded)) {
            return decoded.slice(1);
        }
        return decoded;
    } catch {
        return undefined;
    }
}
