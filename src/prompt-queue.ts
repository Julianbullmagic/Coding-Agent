/**
 * A small, serialized queue of pending user prompts.
 *
 * The chat webview lets a user keep entering prompts while the agent is still
 * working on an earlier one. Rather than dropping those prompts (the old
 * behavior, where the composer was disabled while `loading` was true), every
 * submitted prompt is appended to a queue and processed one at a time, in
 * order, in the background. The user can delete individual queued items before
 * they run, clear the whole queue, or request that processing stop after the
 * current item finishes.
 */

export interface PromptQueueItem {
    /** Stable id used to reference a specific queued item (for deletion). */
    id: string;
    /** The prompt text the user submitted. */
    text: string;
    /** Timestamp (ms epoch) when the item was enqueued, for stable ordering. */
    enqueuedAt: number;
}

function newId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a single queued item from prompt text. Enqueuing is deliberately
 * synchronous and allocation-free beyond building the object, so the UI can
 * add many prompts back to back without any async round-trip.
 */
export function enqueuePrompt(queue: PromptQueueItem[], text: string): PromptQueueItem[] {
    const trimmed = text.trim();
    if (!trimmed) return queue;
    const item: PromptQueueItem = { id: newId(), text: trimmed, enqueuedAt: Date.now() };
    return [...queue, item];
}

/** Remove one queued item by id. Returns a new array (immutably). */
export function removePrompt(queue: PromptQueueItem[], id: string): PromptQueueItem[] {
    return queue.filter((item) => item.id !== id);
}

/** Remove the first (next-to-run) queued item. Returns a new array. */
export function shiftPrompt(queue: PromptQueueItem[]): { item: PromptQueueItem | undefined; queue: PromptQueueItem[] } {
    if (queue.length === 0) return { item: undefined, queue };
    return { item: queue[0], queue: queue.slice(1) };
}
