/**
 * At most `limit` image decodes at once; the others wait their turn, in order. One decode of a
 * large camera picture costs tens of megabytes (about 70 MB for a 200 MP JPEG, more for a busy
 * one), and the server is shared, so uploads in parallel queue here instead of adding up.
 */
export function decodeSlots(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await run();
    } finally {
      // The slot passes straight to the next in line, or is freed.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

/** The decode slots every image pipeline of the process takes one of. */
export const withDecodeSlot = decodeSlots(2);
