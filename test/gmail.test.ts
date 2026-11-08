import { strict as assert } from 'assert';
import {
    validateGmailArgs,
    buildGmailConfirmationMessage,
    isGmailReadOnly,
    buildGmailAuthorizationUrl,
} from '../src/gmail';

describe('Gmail argument validation', () => {
    it('accepts a valid list action', () => {
        assert.equal(validateGmailArgs({ action: 'list' }), null);
    });
    it('rejects an unknown action', () => {
        assert.ok(validateGmailArgs({ action: 'forward' }));
    });
    it('requires a query for search', () => {
        assert.ok(validateGmailArgs({ action: 'search' }));
        assert.equal(validateGmailArgs({ action: 'search', query: 'from:me' }), null);
    });
    it('requires a messageId for read', () => {
        assert.ok(validateGmailArgs({ action: 'read' }));
        assert.equal(validateGmailArgs({ action: 'read', messageId: 'abc' }), null);
    });
    it('requires to/subject/body for send', () => {
        assert.ok(validateGmailArgs({ action: 'send', to: 'a@b.com' }));
        assert.equal(validateGmailArgs({ action: 'send', to: 'a@b.com', subject: 'hi', body: 'hello' }), null);
    });
    it('requires messageId/body for reply', () => {
        assert.ok(validateGmailArgs({ action: 'reply', body: 'hello' }));
        assert.equal(validateGmailArgs({ action: 'reply', messageId: 'abc', body: 'hello' }), null);
    });
});

describe('Gmail confirmation messages', () => {
    it('shows recipient, subject, and body for send', () => {
        const msg = buildGmailConfirmationMessage({ action: 'send', to: 'a@b.com', subject: 'hi', body: 'hello body' });
        assert.ok(msg.includes('a@b.com'));
        assert.ok(msg.includes('hi'));
        assert.ok(msg.includes('hello body'));
    });
    it('shows reply body for reply', () => {
        const msg = buildGmailConfirmationMessage({ action: 'reply', messageId: 'mid', body: 'reply text' });
        assert.ok(msg.includes('mid'));
        assert.ok(msg.includes('reply text'));
    });
});

describe('Gmail read-only classification', () => {
    it('treats list/search/read as read-only', () => {
        assert.equal(isGmailReadOnly('list'), true);
        assert.equal(isGmailReadOnly('search'), true);
        assert.equal(isGmailReadOnly('read'), true);
    });
    it('treats send/reply as mutations', () => {
        assert.equal(isGmailReadOnly('send'), false);
        assert.equal(isGmailReadOnly('reply'), false);
    });
});

describe('Gmail OAuth URL', () => {
    it('contains the gmail scope and client id', () => {
        const url = buildGmailAuthorizationUrl('client123');
        assert.ok(url.includes('client_id=client123'));
        assert.ok(url.includes('gmail.modify'));
    });
});
