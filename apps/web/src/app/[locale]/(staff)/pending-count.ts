// What a pending queue says about the viewer. The backend's `more` means "the scan stopped at its
// bound", not "the viewer has more": a scoped moderator with nothing of their own can still get
// `more: true`. So the mark only goes with a count above zero. The answer's `cap` (the largest
// count a read can report) is no display limit: "`count` or more" is the `more` mark.
export type PendingCount = { count: number; more: boolean };

export function pendingCount(queue: PendingCount): PendingCount {
  return { count: queue.count, more: queue.more && queue.count > 0 };
}

// Both queues as one number, for the moderation link's badge.
export function pendingTotal(
  ...queues: readonly PendingCount[]
): PendingCount | null {
  const shown = queues.map(pendingCount);
  const count = shown.reduce((sum, queue) => sum + queue.count, 0);
  if (count === 0) return null;
  return { count, more: shown.some((queue) => queue.more) };
}
