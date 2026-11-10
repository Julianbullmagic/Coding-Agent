/**
 * Self-healing error log.
 *
 * Every runtime error the agent hits is recorded into a persistent,
 * deduplicated log (VSCode globalState). At the start of each session the
 * extension reads the unresolved entries and feeds them back to the agent as a
 * repair prompt, so the agent attempts to fix its own errors before the user
 * hits them again. Once an error is resolved (either by the agent marking it
 * fixed, or by a successful operation of the same "source"), its entry is
 * marked resolved and no longer queued for repair.
 *
 * The log lives in globalState so it survives across windows and restarts,
 * but it is intentionally small: we keep a bounded number of entries and cap
 * the depth of each stack trace so a runaway loop cannot balloon storage.
 */

export type ErrorSource =
    | 'deepseek-request'
    | 'glm-request'
    | 'calendar'
    | 'gmail'
    | 'github'
    | 'backup'
    | 'model-check'
    | 'repo-bootstrap'
    | 'tool'
    | 'unknown';

export interface ErrorEntry {
    /** Stable fingerprint used to deduplicate repeat occurrences. */
    fingerprint: string;
    /** Human-readable classification of where the error came from. */
    source: ErrorSource;
    /** The error message the user actually saw. */
    message: string;
    /** First stack line(s), truncated, for the agent to inspect. */
    stack?: string;
    /** Epoch ms of the most recent occurrence. */
    lastSeenAt: number;
    /** How many times this exact error has occurred. */
    count: number;
    /** Whether the agent (or a later success) has marked it resolved. */
    resolved: boolean;
    /** Number of repair attempts the agent has made for this entry. */
    repairAttempts: number;
}

export interface ErrorLog {
    entries: ErrorEntry[];
    /** Tracks whether a repair pass has already run this session. */
    lastRepairAt: number;
}

const ERROR_LOG_KEY = 'codingAgent.errorLog';
export const MAX_ERROR_ENTRIES = 50;
export const MAX_STACK_LENGTH = 800;
const MAX_LOG_LIST_LENGTH = 4000;
const RESOLUTION_WINDOW_MS = 5 * 60 * 1000; // same fingerprint within 5 min updates in place

/** Build a stable, short fingerprint from source + message. */
export function fingerprintError(source: ErrorSource, message: string): string {
    const normalized = `${source}:${(message ?? '').trim().replace(/\s+/g, ' ').slice(0, 500)}`;
    // djb2 hash, stable across sessions.
    let hash = 5381;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
    }
    return `${source}:${(hash >>> 0).toString(36)}`;
}

function readLog(context: { globalState: { get<T>(key: string): T | undefined } }): ErrorLog {
    const stored = context.globalState.get<ErrorLog>(ERROR_LOG_KEY);
    if (stored && Array.isArray(stored.entries)) {
        return {
            entries: stored.entries.slice(0, MAX_ERROR_ENTRIES),
            lastRepairAt: typeof stored.lastRepairAt === 'number' ? stored.lastRepairAt : 0,
        };
    }
    return { entries: [], lastRepairAt: 0 };
}

function writeLog(context: { globalState: { update(key: string, value: ErrorLog): Thenable<void> } }, log: ErrorLog): void {
    void context.globalState.update(ERROR_LOG_KEY, {
        entries: log.entries.slice(0, MAX_ERROR_ENTRIES),
        lastRepairAt: log.lastRepairAt,
    });
}

/** Record an error. Returns the entry (existing if deduplicated, new otherwise). */
export async function recordError(
    context: { globalState: { get<T>(key: string): T | undefined; update(key: string, value: ErrorLog): Thenable<void> } },
    source: ErrorSource,
    error: unknown,
): Promise<ErrorEntry> {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack.slice(0, MAX_STACK_LENGTH) : undefined;
    const fingerprint = fingerprintError(source, message);

    const log = readLog(context);
    const now = Date.now();
    const existing = log.entries.find((entry) => entry.fingerprint === fingerprint);

    let entry: ErrorEntry;
    if (existing) {
        existing.count += 1;
        existing.lastSeenAt = now;
        existing.resolved = false; // a new occurrence means it is not actually resolved
        if (stack) existing.stack = stack;
        entry = existing;
    } else {
        entry = {
            fingerprint,
            source,
            message,
            stack,
            lastSeenAt: now,
            count: 1,
            resolved: false,
            repairAttempts: 0,
        };
        log.entries.unshift(entry);
        if (log.entries.length > MAX_ERROR_ENTRIES) {
            log.entries = log.entries.slice(0, MAX_ERROR_ENTRIES);
        }
    }

    writeLog(context, log);
    return entry;
}

/** Mark errors of a given source as resolved (e.g. after a successful operation). */
export async function resolveSource(
    context: { globalState: { get<T>(key: string): T | undefined; update(key: string, value: ErrorLog): Thenable<void> } },
    source: ErrorSource,
): Promise<void> {
    const log = readLog(context);
    let changed = false;
    for (const entry of log.entries) {
        if (entry.source === source && !entry.resolved) {
            entry.resolved = true;
            changed = true;
        }
    }
    if (changed) writeLog(context, log);
}

/** Increment the repair-attempt counter for the given fingerprints. */
export async function bumpRepairAttempts(
    context: { globalState: { get<T>(key: string): T | undefined; update(key: string, value: ErrorLog): Thenable<void> } },
    fingerprints: string[],
): Promise<void> {
    if (fingerprints.length === 0) return;
    const log = readLog(context);
    let changed = false;
    for (const entry of log.entries) {
        if (fingerprints.includes(entry.fingerprint)) {
            entry.repairAttempts += 1;
            changed = true;
        }
    }
    if (changed) writeLog(context, log);
}

/** Get all entries (resolved and unresolved), newest first. */
export function getAllErrors(context: { globalState: { get<T>(key: string): T | undefined } }): ErrorEntry[] {
    const log = readLog(context);
    return [...log.entries].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Get unresolved entries (newest last). */
export function getUnresolvedErrors(context: { globalState: { get<T>(key: string): T | undefined } }): ErrorEntry[] {
    const log = readLog(context);
    return log.entries
        .filter((entry) => !entry.resolved)
        .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
}

/** Build the repair prompt that gets injected at the start of a session. */
export function buildRepairPrompt(entries: ErrorEntry[]): string {
    const lines = entries.slice(0, 20).map((entry) => {
        const parts = [
            `- [${entry.source}] ${entry.message} (occurred ${entry.count}x, last ${new Date(entry.lastSeenAt).toISOString()})`,
        ];
        if (entry.stack) {
            const firstLine = entry.stack.split('\n').slice(0, 4).join(' ').trim();
            parts.push(`    stack: ${firstLine}`);
        }
        return parts.join('\n');
    });
    return [
        'You are running a self-healing pass at the start of a session. The following errors were recorded during previous sessions and may still be unresolved. Inspect the workspace code and try to fix each one if it has not already been fixed. After fixing, apply the fix to the source files (use write_file) and explain what you changed. Do not re-introduce errors that are already resolved.',
        '',
        ...lines,
    ].join('\n');
}

/** Human-readable summary of the log for the status bar / command output. */
export function summarizeLog(context: { globalState: { get<T>(key: string): T | undefined } }): string {
    const log = readLog(context);
    const unresolved = log.entries.filter((entry) => !entry.resolved).length;
    const resolved = log.entries.length - unresolved;
    if (log.entries.length === 0) return 'No recorded errors.';
    return `Coding Agent error log: ${unresolved} open, ${resolved} resolved (${log.entries.length} total).`;
}

/** Format entries for display in a message / list command. */
export function formatLogList(entries: ErrorEntry[]): string {
    if (entries.length === 0) return '';
    const body = entries.slice(0, 30).map((entry) => {
        const status = entry.resolved ? 'resolved' : 'open';
        const attempts = entry.repairAttempts > 0 ? ` (repair attempts: ${entry.repairAttempts})` : '';
        return `${status}\t${entry.source}\t${entry.message}${attempts}`;
    }).join('\n');
    return body.length > MAX_LOG_LIST_LENGTH ? body.slice(0, MAX_LOG_LIST_LENGTH) + '\n…' : body;
}

/** Clear the entire error log. */
export async function clearErrorLog(context: { globalState: { update(key: string, value: ErrorLog): Thenable<void> } }): Promise<void> {
    void context.globalState.update(ERROR_LOG_KEY, { entries: [], lastRepairAt: Date.now() });
}

/** Reset the repair timestamp so a repair pass will run on the next opportunity. */
export async function resetRepairTimestamp(context: { globalState: { get<T>(key: string): T | undefined; update(key: string, value: ErrorLog): Thenable<void> } }): Promise<void> {
    const log = readLog(context);
    log.lastRepairAt = 0;
    writeLog(context, log);
}
