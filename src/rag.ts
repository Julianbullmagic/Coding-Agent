// Retrieval-augmented generation (RAG) over past conversations.
//
// The agent can fetch information from earlier conversations when:
//   1. The user *explicitly* asks it to (e.g. "look back at what we said about X"),
//   2. Or the message *appears* to refer back to prior context (anaphora like
//      "that", "the one we discussed", "as you said before", "the earlier plan").
//
// This module is pure and side-effect free so it can be unit tested without
// VS Code. The actual conversation store lives in extension.ts (workspaceState).

export interface RagMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface RagConversation {
    id: string;
    title: string;
    updatedAt: number;
    messages: RagMessage[];
}

export interface RetrievalResult {
    conversationId: string;
    title: string;
    score: number;
    snippet: string;
}

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'had',
    'has', 'have', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'in', 'is',
    'it', 'its', 'of', 'on', 'or', 'our', 'out', 'she', 'so', 'that', 'the',
    'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we',
    'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'you',
    'your', 'yours', 'yourself', 'me', 'my', 'mine', 'myself',
]);

// Referential/anaphoric markers that strongly suggest the user is pointing back
// at something said earlier, even without an explicit fetch request.
const REFERENTIAL_PATTERNS = [
    /\bthat (?:one|thing|file|repo|project|issue|error|bug|list|conversation|plan|code|change|fix|idea|question|example)\b/i,
    /\bthe (?:one|thing|file|repo|project|issue|error|bug|list|plan|code|change|fix|idea|question|example)\b/i,
    /\bas (?:you|we|i) (?:said|mentioned|noted|wrote|described|discussed|talked about|covered|explained)\b/i,
    /\b(?:you|we) (?:said|mentioned|noted|wrote|described|discussed|talked about|covered|explained)\b/i,
    /\b(?:earlier|before|previously|last time|the other day|just now)\b/i,
    /\b(?:the same|that same|this same)\b/i,
    /\b(?:remember|recall)\b/i,
    /\b(?:earlier|previous|prior) (?:conversation|message|chat|discussion|plan|step|task|work)\b/i,
];

// Explicit requests to fetch/look up prior context.
const EXPLICIT_PATTERNS = [
    /\b(?:fetch|retrieve|look up|lookup|pull up|find|search|recall|reference|check|review|get)\b.{0,40}\b(?:from|in|the|our|your|my)?\s*(?:earlier|previous|prior|past|old|older|history|conversations?|chats?|messages?|discussions?)\b/i,
    /\b(?:earlier|previous|prior|past|old|older) (?:conversations?|chats?|messages?|discussions?|history|threads?)\b/i,
    /\b(?:what did|what have) (?:we|you|i) (?:say|discuss|talk about|decide|agree|mention|cover)\b/i,
    /\b(?:go back|look back|refer back)\b/i,
    /\b(?:our|the) (?:earlier|previous|prior) (?:conversation|chat|discussion|exchange|talk)\b/i,
];

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 0);
}

function contentWords(text: string): string[] {
    return tokenize(text).filter((word) => !STOP_WORDS.has(word) && word.length > 1);
}

// Score how relevant a single conversation is to the user's message using
// simple lexical overlap on content words (a lightweight BM25-like TF score).
function scoreConversation(query: string, conversation: RagConversation): number {
    const queryTerms = contentWords(query);
    if (queryTerms.length === 0) return 0;

    const querySet = new Set(queryTerms);
    const documentTerms = contentWords(conversation.messages.map((message) => message.content).join(' '));
    if (documentTerms.length === 0) return 0;

    // Title boost: a matched title word is a strong relevance signal.
    const titleTerms = contentWords(conversation.title);
    const titleOverlap = titleTerms.filter((term) => querySet.has(term)).length;

    const termFrequency = new Map<string, number>();
    for (const term of documentTerms) {
        termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    }

    let overlap = 0;
    for (const term of querySet) {
        overlap += termFrequency.get(term) ?? 0;
    }

    // Normalize by document length to avoid long conversations dominating.
    const lengthNorm = 1 + Math.log(documentTerms.length + 1);
    return overlap / lengthNorm + titleOverlap * 3;
}

// Build a representative snippet from the conversation, preferring text that
// mentions the query terms.
function buildSnippet(query: string, conversation: RagConversation, maxLength = 600): string {
    const queryTerms = new Set(contentWords(query));
    const lines = conversation.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
        .split(/\n+/)
        .filter((line) => line.trim().length > 0);

    if (lines.length === 0) return conversation.title;

    // Prefer lines that overlap with the query.
    const scored = lines
        .map((line) => {
            const words = contentWords(line);
            const overlap = words.filter((word) => queryTerms.has(word)).length;
            return { line, overlap, recency: lines.length }; // placeholder replaced below
        })
        .map((entry, index) => ({ ...entry, recency: index }));

    scored.sort((a, b) => b.overlap - a.overlap || b.recency - a.recency);

    const best = scored.find((entry) => entry.overlap > 0) ?? scored[scored.length - 1];
    const snippet = best.line.trim();
    return snippet.length > maxLength ? `${snippet.slice(0, maxLength - 1)}\u2026` : snippet;
}

export interface RetrieveOptions {
    query: string;
    conversations: RagConversation[];
    excludeConversationId?: string;
    limit?: number;
    minScore?: number;
}

// Retrieve the most relevant past conversations for a query, excluding the
// currently-open conversation (so we don't echo its own history back).
export function retrieveRelevantContext(options: RetrieveOptions): RetrievalResult[] {
    const {
        query,
        conversations,
        excludeConversationId,
        limit = 3,
        minScore = 0,
    } = options;

    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const candidates = conversations.filter((conversation) => conversation.id !== excludeConversationId);

    const scored = candidates
        .map((conversation) => ({
            conversation,
            score: scoreConversation(normalizedQuery, conversation),
        }))
        .filter((entry) => entry.score >= minScore)
        .sort((a, b) => b.score - a.score);

    return scored.slice(0, Math.max(0, Math.floor(limit))).map((entry) => ({
        conversationId: entry.conversation.id,
        title: entry.conversation.title,
        score: Math.round(entry.score * 1000) / 1000,
        snippet: buildSnippet(normalizedQuery, entry.conversation),
    }));
}

// Heuristic: does this message appear to refer back to earlier context?
export function isReferential(message: string): boolean {
    const text = message.trim();
    if (!text) return false;
    return REFERENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

// Heuristic: does this message explicitly ask the agent to fetch prior info?
export function isExplicitFetchRequest(message: string): boolean {
    const text = message.trim();
    if (!text) return false;
    return EXPLICIT_PATTERNS.some((pattern) => pattern.test(text));
}

// Decide whether RAG should run for a given message. Runs when the user
// explicitly requests prior context OR appears to refer back to it.
export function shouldRetrieve(message: string): boolean {
    return isExplicitFetchRequest(message) || isReferential(message);
}

// Format retrieved context for injection into the model prompt.
export function formatRetrievedContext(results: RetrievalResult[]): string {
    if (results.length === 0) return '';
    const lines = results.map((result, index) => {
        const label = result.title || 'Untitled conversation';
        return `${index + 1}. [${label}] (relevance ${result.score})\n${result.snippet}`;
    });
    return [
        'The following context was retrieved from earlier conversations and may be relevant to the user\'s request. Use it to ground your answer, but do not claim details that are not present.',
        ...lines,
    ].join('\n\n');
}
