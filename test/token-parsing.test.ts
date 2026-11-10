import { strict as assert } from 'assert';
import {
    normalizeTokens,
    coerceExpiresIn,
    isTokenExpired,
    extractAuthorizationCode,
} from '../src/google-calendar';
import {
    normalizeTokens as normalizeGmailTokens,
    coerceExpiresIn as coerceGmailExpiresIn,
    isTokenExpired as isGmailTokenExpired,
    extractGmailAuthorizationCode,
} from '../src/gmail';

describe('coerceExpiresIn', () => {
    it('accepts a number', () => {
        assert.equal(coerceExpiresIn(3600), 3600);
    });
    it('coerces a numeric string', () => {
        assert.equal(coerceExpiresIn('3600'), 3600);
    });
    it('rejects missing/zero/negative/non-numeric', () => {
        assert.equal(coerceExpiresIn(undefined), undefined);
        assert.equal(coerceExpiresIn(0), undefined);
        assert.equal(coerceExpiresIn(-5), undefined);
        assert.equal(coerceExpiresIn('abc'), undefined);
    });
    it('gmail variant behaves the same', () => {
        assert.equal(coerceGmailExpiresIn('1200'), 1200);
        assert.equal(coerceGmailExpiresIn(0), undefined);
    });
});

describe('normalizeTokens', () => {
    it('returns null without an access token', () => {
        assert.equal(normalizeTokens(null), null);
        assert.equal(normalizeTokens({}), null);
        assert.equal(normalizeTokens({ access_token: '' }), null);
        assert.equal(normalizeTokens('not-an-object'), null);
    });
    it('extracts access and refresh tokens, trims whitespace', () => {
        const tokens = normalizeTokens({ access_token: '  abc  ', refresh_token: ' r ', expires_at: 123 });
        assert.equal(tokens?.access_token, 'abc');
        assert.equal(tokens?.refresh_token, 'r');
        assert.equal(tokens?.expires_at, 123);
    });
    it('computes expires_at from expires_in (string or number)', () => {
        const before = Date.now();
        const fromNumber = normalizeTokens({ access_token: 'a', expires_in: 3600 });
        const fromString = normalizeTokens({ access_token: 'a', expires_in: '3600' });
        assert.ok(fromNumber && fromNumber.expires_at && fromNumber.expires_at >= before + 3600 * 1000 - 1000);
        assert.ok(fromString && fromString.expires_at && fromString.expires_at >= before + 3600 * 1000 - 1000);
    });
    it('gmail normalize parses a JSON string round-trip', () => {
        const raw = JSON.stringify({ access_token: 'tok', refresh_token: 'refresh', expires_in: 100 });
        const tokens = normalizeGmailTokens(JSON.parse(raw));
        assert.equal(tokens?.access_token, 'tok');
        assert.equal(tokens?.refresh_token, 'refresh');
    });
});

describe('isTokenExpired', () => {
    it('returns false when no expires_at is present', () => {
        assert.equal(isTokenExpired({ access_token: 'a' }), false);
    });
    it('returns true when within the refresh buffer', () => {
        assert.equal(isTokenExpired({ access_token: 'a', expires_at: Date.now() + 1000 }), true);
    });
    it('returns false when far in the future', () => {
        assert.equal(isTokenExpired({ access_token: 'a', expires_at: Date.now() + 3600 * 1000 }), false);
        assert.equal(isTokenExpired({ access_token: 'a', expires_at: Date.now() + 120000 }), false);
    });
    it('gmail variant behaves the same', () => {
        assert.equal(isGmailTokenExpired({ access_token: 'a', expires_at: Date.now() + 1000 }), true);
    });
});

describe('authorization code extraction', () => {
    it('extracts the code from a full redirect URL', () => {
        const url = 'http://localhost/?code=4/0Acv&scope=https%3A%2F%2Fwww.googleapis.com';
        assert.equal(extractAuthorizationCode(url), '4/0Acv');
    });
    it('returns a raw URL-safe code verbatim (does not truncate)', () => {
        const code = '4-0Acv_xK.e~Tz';
        assert.equal(extractAuthorizationCode(code), code);
        assert.equal(extractGmailAuthorizationCode(code), code);
    });
    it('returns a raw code that contains a slash verbatim', () => {
        // Real Google codes look like "4/0Aea..." — the slash must survive.
        const code = '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ';
        assert.equal(extractAuthorizationCode(code), code);
        assert.equal(extractGmailAuthorizationCode(code), code);
    });
    it('percent-decodes a clipboard code (%2F -> /)', () => {
        // The address bar shows "4%2F0Aea..." — this is the code the user
        // actually copies. It must decode to "4/0Aea...".
        const encoded = '4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ';
        assert.equal(extractGmailAuthorizationCode(encoded), '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ');
        assert.equal(extractAuthorizationCode(encoded), '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ');
    });
    it('extracts the code from a bare code=... fragment without a scheme', () => {
        const fragment = 'code=4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ&scope=https%3A%2F%2Fmail.google.com%2F';
        assert.equal(extractGmailAuthorizationCode(fragment), '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ');
        assert.equal(extractAuthorizationCode(fragment), '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ');
    });
    it('extracts the code from a leading-? query string', () => {
        const qs = '?code=4%2F0AeaYSHDk9zVzy3CjPy2RBexK8zEQ';
        assert.equal(extractGmailAuthorizationCode(qs), '4/0AeaYSHDk9zVzy3CjPy2RBexK8zEQ');
    });
    it('trims surrounding whitespace', () => {
        assert.equal(extractAuthorizationCode('  somecode  '), 'somecode');
    });
});
