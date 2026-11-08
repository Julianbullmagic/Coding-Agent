import { strict as assert } from 'assert';
import {
    validateCalendarArgs,
    buildConfirmationMessage,
    isReadOnly,
    buildAuthorizationUrl,
    CalendarToolArgs,
} from '../src/google-calendar';

describe('Calendar argument validation', () => {
    it('accepts a valid list action', () => {
        assert.equal(validateCalendarArgs({ action: 'list' }), null);
    });

    it('rejects an unknown action', () => {
        assert.ok(validateCalendarArgs({ action: 'explode' }) !== null);
    });

    it('requires summary, start, and end for create', () => {
        assert.ok(validateCalendarArgs({ action: 'create' }) !== null);
        assert.ok(validateCalendarArgs({ action: 'create', summary: 'x' }) !== null);
        assert.ok(validateCalendarArgs({ action: 'create', summary: 'x', start: '2026-01-01T09:00:00Z' }) !== null);
        assert.equal(validateCalendarArgs({ action: 'create', summary: 'x', start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z' }), null);
    });

    it('rejects create when end is not after start', () => {
        assert.ok(validateCalendarArgs({
            action: 'create',
            summary: 'x',
            start: '2026-01-01T10:00:00Z',
            end: '2026-01-01T09:00:00Z',
        }) !== null);
    });

    it('rejects invalid dates for create', () => {
        assert.ok(validateCalendarArgs({
            action: 'create',
            summary: 'x',
            start: 'not-a-date',
            end: '2026-01-01T10:00:00Z',
        }) !== null);
    });

    it('requires eventId for update and delete', () => {
        assert.ok(validateCalendarArgs({ action: 'update' }) !== null);
        assert.ok(validateCalendarArgs({ action: 'delete' }) !== null);
        assert.equal(validateCalendarArgs({ action: 'update', eventId: 'abc123' }), null);
        assert.equal(validateCalendarArgs({ action: 'delete', eventId: 'abc123' }), null);
    });
});

describe('Calendar confirmation messages', () => {
    it('shows event details for create', () => {
        const args: CalendarToolArgs = {
            action: 'create',
            summary: 'Team meeting',
            start: '2026-01-01T09:00:00Z',
            end: '2026-01-01T10:00:00Z',
            location: 'Room 4',
        };
        const message = buildConfirmationMessage(args);
        assert.ok(message.includes('Team meeting'));
        assert.ok(message.includes('2026-01-01T09:00:00Z'));
        assert.ok(message.includes('Room 4'));
    });

    it('flags delete as irreversible', () => {
        const message = buildConfirmationMessage({ action: 'delete', eventId: 'abc' });
        assert.ok(message.includes('abc'));
        assert.ok(message.toLowerCase().includes('delete'));
    });

    it('shows changed fields for update', () => {
        const message = buildConfirmationMessage({
            action: 'update',
            eventId: 'evt1',
            summary: 'New title',
            start: '2026-01-02T09:00:00Z',
            end: '2026-01-02T10:00:00Z',
        });
        assert.ok(message.includes('evt1'));
        assert.ok(message.includes('New title'));
    });
});

describe('Calendar read-only classification', () => {
    it('treats list as read-only', () => {
        assert.equal(isReadOnly('list'), true);
    });

    it('treats create/update/delete as mutations', () => {
        assert.equal(isReadOnly('create'), false);
        assert.equal(isReadOnly('update'), false);
        assert.equal(isReadOnly('delete'), false);
    });
});

describe('OAuth authorization URL', () => {
    it('builds a URL containing client id and scheme', () => {
        const url = buildAuthorizationUrl('test-client-id');
        assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
        assert.ok(url.includes('client_id=test-client-id'));
        assert.ok(url.includes('response_type=code'));
        assert.ok(url.includes('access_type=offline'));
    });
});
