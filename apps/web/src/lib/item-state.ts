import { createKeyedStore } from "@/lib/keyed-store";

// A change the visitor made to something the server drew (a reaction, a bookmark, a follow): the
// value they set and the value the server had drawn when they set it. The change shows while the
// server still draws the old value; once the server draws something else (the screen was drawn
// again, with the change in it or with another one), the server's value is the newer.
export type ItemChange<T> = { drawn: T; value: T };

const changes = createKeyedStore<ItemChange<unknown>>();

// What to show: the visitor's change while it still sits on the value the server drew.
export function shownValue<T>(change: ItemChange<T> | undefined, drawn: T): T {
  return change && Object.is(change.drawn, drawn) ? change.value : drawn;
}

export function useItemState<T>(key: string, drawn: T): T {
  return shownValue(changes.use(key) as ItemChange<T> | undefined, drawn);
}

// Shows `next` at once and asks the server to make it so. A refusal (or a call that fails) puts
// back what was shown before and says why; nothing is left changed.
export async function changeItem<T>(
  key: string,
  drawn: T,
  next: T,
  run: () => Promise<{ error?: string } | undefined>,
): Promise<string | undefined> {
  const before = changes.get(key) as ItemChange<T> | undefined;
  const wasShown = shownValue(before, drawn);
  changes.set(key, { drawn, value: next });
  try {
    const answer = await run();
    if (answer?.error === undefined) return undefined;
    changes.set(key, before ?? { drawn, value: wasShown });
    return answer.error;
  } catch {
    changes.set(key, before ?? { drawn, value: wasShown });
    return undefined;
  }
}

// For tests: the stored changes.
export const itemChanges = changes;
