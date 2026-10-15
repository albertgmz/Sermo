// The draft of a new thread, kept in the tab's session storage so that closing the composer (a
// link back to the forum) or reloading the page does not lose what was written. One draft for the
// tab: the forum is a field of the thread, not a key of the draft. Storage can be missing or throw
// (private windows, blocked site data), and then the draft is simply not kept.

export type ThreadDraft = { title: string; body: string; prefixId: string };

export const THREAD_DRAFT_KEY = "sermo:thread-draft";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function session(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isEmptyDraft(draft: ThreadDraft) {
  return !draft.title.trim() && !draft.body.trim() && !draft.prefixId;
}

export function readThreadDraft(store: Store | null = session()) {
  try {
    const raw = store?.getItem(THREAD_DRAFT_KEY);
    if (!raw) return null;
    const value: Partial<Record<keyof ThreadDraft, unknown>> | null =
      JSON.parse(raw);
    if (
      typeof value?.title !== "string" ||
      typeof value.body !== "string" ||
      typeof value.prefixId !== "string"
    ) {
      return null;
    }
    const draft = {
      title: value.title,
      body: value.body,
      prefixId: value.prefixId,
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

// Keeps the draft, or forgets it when there is nothing in it.
export function writeThreadDraft(
  draft: ThreadDraft,
  store: Store | null = session(),
) {
  try {
    if (isEmptyDraft(draft)) store?.removeItem(THREAD_DRAFT_KEY);
    else store?.setItem(THREAD_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Not kept.
  }
}

export function clearThreadDraft(store: Store | null = session()) {
  try {
    store?.removeItem(THREAD_DRAFT_KEY);
  } catch {
    // Nothing to forget.
  }
}
