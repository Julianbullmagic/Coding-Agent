import { strict as assert } from 'assert';
import {
    RagConversation,
    retrieveRelevantContext,
    isReferential,
    isExplicitFetchRequest,
    shouldRetrieve,
    formatRetrievedContext,
} from '../src/rag';

function makeConversation(id: string, title: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): RagConversation {
    return { id, title, updatedAt: Date.now(), messages };
}

describe('RAG retrieval', () => {
    const conversations: RagConversation[] = [
        makeConversation('c1', 'Deploying the API', [
            { role: 'user', content: 'How do I deploy the API to production?' },
            { role: 'assistant', content: 'We set up a Docker container and a CI pipeline that builds the image.' },
        ]),
        makeConversation('c2', 'Fixing the login bug', [
            { role: 'user', content: 'The login prompt never appears on reload.' },
            { role: 'assistant', content: 'The bug was a stale PATH so gh was not found, plus a missing activate function.' },
        ]),
        makeConversation('c3', 'Designing the database schema', [
            { role: 'user', content: 'What tables do we need for users and posts?' },
            { role: 'assistant', content: 'You need a users table, a posts table, and a foreign key linking posts to users.' },
        ]),
    ];

    it('retrieves the most relevant past conversation by lexical overlap', () => {
        const results = retrieveRelevantContext({
            query: 'How did we deploy the API?',
            conversations,
            excludeConversationId: 'unused',
        });

        assert.ok(results.length > 0);
        assert.equal(results[0].conversationId, 'c1');
        assert.equal(results[0].title, 'Deploying the API');
    });

    it('excludes the currently open conversation', () => {
        const results = retrieveRelevantContext({
            query: 'deploy the API',
            conversations,
            excludeConversationId: 'c1',
        });
        assert.ok(!results.some((result) => result.conversationId === 'c1'));
    });

    it('returns empty when no conversation overlaps the query', () => {
        const results = retrieveRelevantContext({
            query: 'quantum lattice encryption protocol',
            conversations,
            minScore: 0.5,
            excludeConversationId: 'unused',
        });
        assert.equal(results.length, 0);
    });

    it('limits the number of results', () => {
        const results = retrieveRelevantContext({
            query: 'the bug and the schema and the deploy',
            conversations,
            limit: 2,
            excludeConversationId: 'unused',
        });
        assert.ok(results.length <= 2);
    });

    it('returns empty for a blank query', () => {
        const results = retrieveRelevantContext({ query: '   ', conversations, excludeConversationId: 'unused' });
        assert.equal(results.length, 0);
    });
});

describe('RAG trigger heuristics', () => {
    it('detects explicit fetch requests', () => {
        assert.ok(isExplicitFetchRequest('Can you look up what we said in earlier conversations about the API?'));
        assert.ok(isExplicitFetchRequest('Fetch the details from our earlier chat.'));
        assert.ok(isExplicitFetchRequest('What did we decide about the database schema previously?'));
    });

    it('detects referential references to earlier context', () => {
        assert.ok(isReferential('What about that bug we discussed earlier?'));
        assert.ok(isReferential('As you said before, the PATH was stale.'));
        assert.ok(isReferential('Can we go back to the plan from the previous conversation?'));
    });

    it('does not trigger on ordinary new topics', () => {
        assert.ok(!isReferential('Write a function that sorts an array.'));
        assert.ok(!isExplicitFetchRequest('Write a function that sorts an array.'));
        assert.ok(!shouldRetrieve('Write a function that sorts an array.'));
    });

    it('triggers shouldRetrieve on either explicit or referential cues', () => {
        assert.ok(shouldRetrieve('look up what we said earlier'));
        assert.ok(shouldRetrieve('as you mentioned before'));
    });
});

describe('formatRetrievedContext', () => {
    it('formats results with title and snippet', () => {
        const results = retrieveRelevantContext({
            query: 'deploy the API',
            conversations: [
                makeConversation('c1', 'Deploying the API', [
                    { role: 'user', content: 'How do I deploy the API to production?' },
                    { role: 'assistant', content: 'We set up a Docker container and a CI pipeline.' },
                ]),
            ],
            excludeConversationId: 'unused',
        });
        const formatted = formatRetrievedContext(results);
        assert.ok(formatted.includes('Deploying the API'));
        assert.ok(formatted.includes('deploy'));
    });

    it('returns empty string when there are no results', () => {
        assert.equal(formatRetrievedContext([]), '');
    });
});
