import { strict as assert } from 'assert';
import {
    validateBusinessArgs,
    buildBusinessConfirmationMessage,
    isBusinessReadOnly,
    buildBusinessAuthorizationUrl,
    extractBusinessAuthorizationCode,
    normalizeTokens,
    isTokenExpired,
    BusinessToolArgs,
} from '../src/business-reviews';

describe('Business reviews argument validation', () => {
    it('accepts a valid list_reviews action', () => {
        assert.equal(validateBusinessArgs({ action: 'list_reviews' }), null);
        assert.equal(validateBusinessArgs({ action: 'list_reviews', pageSize: 20 }), null);
        assert.equal(validateBusinessArgs({ action: 'list_reviews', orderBy: 'rating desc' }), null);
    });

    it('rejects an unknown action', () => {
        assert.ok(validateBusinessArgs({ action: 'explode' }) !== null);
    });

    it('rejects out-of-range pageSize', () => {
        assert.ok(validateBusinessArgs({ action: 'list_reviews', pageSize: 0 }) !== null);
        assert.ok(validateBusinessArgs({ action: 'list_reviews', pageSize: 51 }) !== null);
        assert.ok(validateBusinessArgs({ action: 'list_reviews', pageSize: 2.5 }) !== null);
    });

    it('requires reviewName and replyComment for reply_review', () => {
        assert.ok(validateBusinessArgs({ action: 'reply_review' }) !== null);
        assert.ok(validateBusinessArgs({ action: 'reply_review', reviewName: 'accounts/1/locations/2/reviews/3' }) !== null);
        assert.ok(validateBusinessArgs({ action: 'reply_review', replyComment: 'Thanks!' }) !== null);
        assert.equal(validateBusinessArgs({
            action: 'reply_review',
            reviewName: 'accounts/1/locations/2/reviews/3',
            replyComment: 'Thanks for the great review!',
        }), null);
    });

    it('rejects reply comments over the 4096-character limit', () => {
        assert.ok(validateBusinessArgs({
            action: 'reply_review',
            reviewName: 'accounts/1/locations/2/reviews/3',
            replyComment: 'a'.repeat(4097),
        }) !== null);
        assert.equal(validateBusinessArgs({
            action: 'reply_review',
            reviewName: 'accounts/1/locations/2/reviews/3',
            replyComment: 'a'.repeat(4096),
        }), null);
    });
});

describe('Business reviews read-only classification', () => {
    it('treats list_reviews as read-only', () => {
        assert.equal(isBusinessReadOnly('list_reviews'), true);
    });

    it('treats reply_review as a mutation', () => {
        assert.equal(isBusinessReadOnly('reply_review'), false);
    });
});

describe('Business reviews confirmation messages', () => {
    it('shows the review name and reply preview', () => {
        const args: BusinessToolArgs = {
            action: 'reply_review',
            reviewName: 'accounts/123/locations/456/reviews/789',
            replyComment: 'Thank you so much for the kind words! It was a pleasure performing at your event.',
        };
        const message = buildBusinessConfirmationMessage(args);
        assert.ok(message.includes('accounts/123/locations/456/reviews/789'));
        assert.ok(message.includes('Thank you so much'));
    });

    it('truncates long replies in the preview', () => {
        const longReply = 'x'.repeat(500);
        const message = buildBusinessConfirmationMessage({
            action: 'reply_review',
            reviewName: 'accounts/1/locations/2/reviews/3',
            replyComment: longReply,
        });
        assert.ok(message.length < longReply.length + 100);
        assert.ok(message.includes('...'));
    });
});

describe('Business reviews OAuth helpers', () => {
    it('builds an authorization URL with the business.manage scope', () => {
        const url = buildBusinessAuthorizationUrl('test-client-id');
        assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
        assert.ok(url.includes('client_id=test-client-id'));
        assert.ok(url.includes('scope=' + encodeURIComponent('https://www.googleapis.com/auth/business.manage')));
        assert.ok(url.includes('access_type=offline'));
    });

    it('extracts a code from a full redirect URL, decoding %2F', () => {
        const code = extractBusinessAuthorizationCode('http://localhost/?code=4%2F0AeaYSHB&scope=x');
        assert.equal(code, '4/0AeaYSHB');
    });

    it('extracts a bare code verbatim, preserving slashes', () => {
        assert.equal(extractBusinessAuthorizationCode('  4/0AeaYSHB  '), '4/0AeaYSHB');
    });

    it('normalizes token payloads and detects expiry', () => {
        const tokens = normalizeTokens({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: '3600',
        });
        assert.ok(tokens);
        assert.equal(tokens.access_token, 'at');
        assert.equal(tokens.refresh_token, 'rt');
        assert.ok(typeof tokens.expires_at === 'number');
        assert.equal(isTokenExpired(tokens), false);

        const expired = normalizeTokens({ access_token: 'at', expires_at: Date.now() - 1000 });
        assert.ok(expired);
        assert.equal(isTokenExpired(expired), true);
    });

    it('rejects payloads without an access token', () => {
        assert.equal(normalizeTokens({}), null);
        assert.equal(normalizeTokens('nonsense'), null);
        assert.equal(normalizeTokens(null), null);
    });
});
