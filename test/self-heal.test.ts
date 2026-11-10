import { strict as assert } from 'assert';
import {
    ErrorEntry,
    ErrorSource,
    fingerprintError,
    recordError,
    resolveSource,
    getUnresolvedErrors,
    getAllErrors,
    buildRepairPrompt,
    summarizeLog,
    formatLogList,
    clearErrorLog,
    bumpRepairAttempts,
} from '../src/self-heal';

// A minimal in-memory fake of VSCode's globalState so tests run without the host.
class FakeGlobalState {
    private map = new Map<string, unknown>();
    get<T>(key: string): T | undefined {
        return this.map.get(key) as T | undefined;
    }
    update(key: string, value: unknown): Thenable<void> {
        this.map.set(key, value);
        return Promise.resolve();
    }
    _raw(): Map<string, unknown> {
        return this.map;
    }
}

function makeContext(): { globalState: FakeGlobalState } {
    return { globalState: new FakeGlobalState() };
}

describe('self-heal fingerprint', () => {
    it('is stable for the same source and message', () => {
        const a = fingerprintError('gmail', 'Authorization failed');
        const b = fingerprintError('gmail', 'Authorization failed');
        assert.equal(a, b);
    });

    it('differs across sources and messages', () => {
        const a = fingerprintError('gmail', 'Authorization failed');
        const b = fingerprintError('calendar', 'Authorization failed');
        const c = fingerprintError('gmail', 'Different message');
        assert.notEqual(a, b);
        assert.notEqual(a, c);
    });
});

describe('recordError', () => {
    it('records a new entry as unresolved', async () => {
        const ctx = makeContext();
        const entry = await recordError(ctx, 'gmail', new Error('Authorization failed'));
        assert.equal(entry.source, 'gmail');
        assert.equal(entry.resolved, false);
        assert.equal(entry.count, 1);
        assert.equal(entry.repairAttempts, 0);
        assert.ok(entry.fingerprint.length > 0);
        assert.ok(entry.stack);
    });

    it('deduplicates repeat occurrences by fingerprint', async () => {
        const ctx = makeContext();
        const first = await recordError(ctx, 'gmail', new Error('Same error'));
        const second = await recordError(ctx, 'gmail', new Error('Same error'));
        assert.equal(first.fingerprint, second.fingerprint);
        assert.equal(second.count, 2);
        const all = getAllErrors(ctx);
        assert.equal(all.length, 1);
    });

    it('coerces non-Error values to a message', async () => {
        const ctx = makeContext();
        const entry = await recordError(ctx, 'tool', 'just a string');
        assert.equal(entry.message, 'just a string');
        assert.equal(entry.source, 'tool');
    });
});

describe('resolveSource / unresolved filtering', () => {
    it('marks matching sources resolved and excludes them from unresolved list', async () => {
        const ctx = makeContext();
        await recordError(ctx, 'gmail', new Error('gmail bug'));
        await recordError(ctx, 'calendar', new Error('calendar bug'));
        await resolveSource(ctx, 'gmail');

        const unresolved = getUnresolvedErrors(ctx);
        assert.equal(unresolved.length, 1);
        assert.equal(unresolved[0].source, 'calendar');

        const all = getAllErrors(ctx);
        assert.equal(all.length, 2);
        assert.ok(all.some((entry) => entry.source === 'gmail' && entry.resolved));
    });

    it('a new occurrence of a resolved error flips it back to unresolved', async () => {
        const ctx = makeContext();
        await recordError(ctx, 'gmail', new Error('gmail bug'));
        await resolveSource(ctx, 'gmail');
        await recordError(ctx, 'gmail', new Error('gmail bug'));

        const unresolved = getUnresolvedErrors(ctx);
        assert.equal(unresolved.length, 1);
        assert.equal(unresolved[0].resolved, false);
    });
});

describe('buildRepairPrompt', () => {
    it('includes each error message and source', async () => {
        const ctx = makeContext();
        await recordError(ctx, 'gmail', new Error('Authorization failed'));
        await recordError(ctx, 'backup', new Error('gh not found'));
        const entries = getUnresolvedErrors(ctx);
        const prompt = buildRepairPrompt(entries);
        assert.ok(prompt.includes('[gmail] Authorization failed'));
        assert.ok(prompt.includes('[backup] gh not found'));
        assert.ok(prompt.includes('self-healing pass'));
    });
});

describe('summarizeLog / formatLogList', () => {
    it('summarizes counts', async () => {
        const ctx = makeContext();
        assert.equal(summarizeLog(ctx), 'No recorded errors.');
        await recordError(ctx, 'gmail', new Error('one'));
        await recordError(ctx, 'backup', new Error('two'));
        const summary = summarizeLog(ctx);
        assert.ok(summary.includes('2 open'));
        assert.ok(summary.includes('0 resolved'));
    });

    it('formats entries for display', async () => {
        const ctx = makeContext();
        await recordError(ctx, 'gmail', new Error('Authorization failed'));
        const list = formatLogList(getAllErrors(ctx));
        assert.ok(list.includes('open'));
        assert.ok(list.includes('gmail'));
        assert.ok(list.includes('Authorization failed'));
    });
});

describe('bumpRepairAttempts', () => {
    it('increments repair attempts for matching fingerprints', async () => {
        const ctx = makeContext();
        const entry = await recordError(ctx, 'gmail', new Error('Authorization failed'));
        await bumpRepairAttempts(ctx, [entry.fingerprint]);
        const all = getAllErrors(ctx);
        assert.equal(all[0].repairAttempts, 1);
    });
});

describe('clearErrorLog', () => {
    it('empties the log', async () => {
        const ctx = makeContext();
        await recordError(ctx, 'gmail', new Error('one'));
        await clearErrorLog(ctx);
        assert.equal(getAllErrors(ctx).length, 0);
    });
});
