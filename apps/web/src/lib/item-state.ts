import { createKeyedStore } from "@/lib/keyed-store";
import { currentEpoch, registerStore } from "@/lib/session-epoch";

// A change the visitor made to something the server drew (a reaction, a bookmark, a follow), or a
// value a poll found (an unread count): the value, the value the server had drawn when it was
// made, and when the server answered (`settledAt`, null while it has not). Everything is ordered
// by one counter, not by a clock.
export type ItemChange<T> = {
  drawn: T;
  value: T;
  settledAt: number | null;
  // The server refused it: a later refusal must not bring it back.
  refused?: boolean;
};

let clock = 0;
const changes = createKeyedStore<ItemChange<unknown>>();
registerStore(changes);

// When the markup a component was drawn from reached the browser. A component's props are the
// server's: a screen drawn again sends new ones, while a row drawn again from the markup a list
// keeps (it scrolled away and back) has the same ones, so the first time an object of props is
// seen stands for when the server drew it. That holds only while the props are the server's own
// element: a client component that builds a button again on its own re-render (as the props of a
// spread) makes new props that look drawn just now. Such a parent keeps the element (`useMemo` on
// what the server sent); a source scan holds the places that create these buttons to it.
const delivered = new WeakMap<object, number>();
function deliveredAt(props: object) {
  let at = delivered.get(props);
  if (at === undefined) {
    at = ++clock;
    delivered.set(props, at);
  }
  return at;
}

// What to show. The change, while the server still draws what it drew when the change was made and
// has not drawn anything since it was settled: markup that reached the browser after the server
// answered was drawn with the answer in it (or with something newer), so it is the truth, even
// when it reads the same as before the change. Markup older than the change (a row a list kept)
// shows the change.
export function shownValue<T>(
  change: ItemChange<T> | undefined,
  drawn: T,
  delivered = 0,
): T {
  if (!change || !Object.is(change.drawn, drawn)) return drawn;
  if (change.settledAt !== null && delivered > change.settledAt) return drawn;
  return change.value;
}

// `props` are the component's own props: they say how old its markup is.
export function useItemState<T>(key: string, drawn: T, props: object): T {
  return shownValue(
    changes.use(key) as ItemChange<T> | undefined,
    drawn,
    deliveredAt(props),
  );
}

export type ChangeAnswer = { error?: string; signIn?: string } | undefined;
export type ChangeResult = { error?: string; signIn?: string };

// Shows `next` at once and asks the server to make it so. A refusal, a session that ended
// (`signIn`, where to sign in) or a call that fails puts back what was shown before and says why
// (`failed` when the call itself failed); nothing is left changed. A newer change to the same key
// made meanwhile is left alone by an older answer.
export async function changeItem<T>(
  key: string,
  drawn: T,
  next: T,
  run: () => Promise<ChangeAnswer>,
  failed: string,
): Promise<ChangeResult> {
  const epoch = currentEpoch();
  const before = changes.get(key) as ItemChange<T> | undefined;
  const mine: ItemChange<T> = { drawn, value: next, settledAt: null };
  changes.set(key, mine);
  let answer: ChangeAnswer;
  let thrown = false;
  try {
    answer = await run();
  } catch {
    thrown = true;
  }
  const result: ChangeResult = thrown
    ? { error: failed }
    : { error: answer?.error, signIn: answer?.signIn };
  const refused = result.error !== undefined || result.signIn !== undefined;
  // The visitor changed while the call was out: nothing of it is theirs to show now.
  if (epoch !== currentEpoch()) return refused ? result : {};
  if (refused) {
    mine.refused = true;
    if (changes.get(key) === mine) {
      changes.set(key, before && !before.refused ? before : undefined);
    }
    return result;
  }
  if (changes.get(key) === mine) {
    changes.set(key, { ...mine, settledAt: ++clock });
  }
  return {};
}

// Shows `value` for an item that the server drew as `drawn`, for something learned without the
// visitor doing anything (a poll).
export function setItemState<T>(key: string, drawn: T, value: T) {
  changes.set(key, { drawn, value, settledAt: ++clock });
}

// For tests: the stored changes.
export const itemChanges = changes;
