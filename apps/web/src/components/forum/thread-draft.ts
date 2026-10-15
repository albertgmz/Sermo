import { withoutAttachTags } from "@/components/forum/composer-insert";

// The draft of a new thread, kept in the tab's session storage so that closing the composer (a
// link back to the forum) or reloading the page does not lose what was written. One draft per
// member in the tab: the forum is a field of the thread, not a key of the draft, and a member who
// signs in on the same tab does not see another's. Storage can be missing or throw (private
// windows, blocked site data), and then the draft is simply not kept. Emptying the fields forgets
// the draft, which is how a member throws it away.

export type ThreadDraft = { title: string; body: string; prefixId: string };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const threadDraftKey = (owner: number) => `sermo:thread-draft:${owner}`;

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

// The files of a draft are not kept (they come back as a list only while the page stays), so the
// tags that placed them go: a tag with no file behind it would be sent as a missing attachment.
export function readThreadDraft(owner: number | null, store = session()) {
  try {
    const raw = owner === null ? null : store?.getItem(threadDraftKey(owner));
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
      body: withoutAttachTags(value.body),
      prefixId: value.prefixId,
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

// Keeps the draft, or forgets it when there is nothing in it.
export function writeThreadDraft(
  owner: number | null,
  draft: ThreadDraft,
  store = session(),
) {
  try {
    if (owner === null) return;
    if (isEmptyDraft(draft)) store?.removeItem(threadDraftKey(owner));
    else store?.setItem(threadDraftKey(owner), JSON.stringify(draft));
  } catch {
    // Not kept.
  }
}

export function clearThreadDraft(owner: number | null, store = session()) {
  try {
    if (owner !== null) store?.removeItem(threadDraftKey(owner));
  } catch {
    // Nothing to forget.
  }
}
