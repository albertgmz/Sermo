// What the backend says the viewer may do in a thread's forum (`resolvedPermissions` of
// `threads.get`), read for the controls that depend on it. Nothing here decides anything: a
// control is shown when the backend's flag is set, and every action is checked again by it.
type Resolved = Record<string, boolean | number>;

export type ThreadMay = {
  stick: boolean;
  lock: boolean;
  move: boolean;
  merge: boolean;
  split: boolean;
  delete: boolean;
  attach: boolean;
  // Bringing back a deleted, or approving a waiting, post or thread.
  restoreDeleted: boolean;
  restoreWaiting: boolean;
  // Whether any item of the moderation menu applies.
  any: boolean;
};

export function threadMay(resolved: Resolved): ThreadMay {
  const flag = (key: string) => resolved[key] === true;
  const may = {
    stick: flag("forum.stick"),
    lock: flag("forum.lock"),
    move: flag("forum.move"),
    merge: flag("forum.merge"),
    split: flag("forum.split"),
    delete: flag("forum.deleteAny"),
    attach: flag("forum.uploadAttachments"),
    restoreDeleted: flag("forum.undelete"),
    restoreWaiting: flag("forum.approve"),
  };
  return {
    ...may,
    any:
      may.stick ||
      may.lock ||
      may.move ||
      may.merge ||
      may.split ||
      may.delete ||
      may.restoreDeleted ||
      may.restoreWaiting,
  };
}

// Whether to offer bringing a post or thread in this state back. A display hint that copies the
// backend's rule for threads.restore and posts.restore: a deleted one needs forum.undelete and one
// waiting for approval needs forum.approve. If the backend's rule changes the button is wrongly
// shown or hidden, and a refusal comes back as the message under the button; it decides nothing.
export function mayRestore(
  may: ThreadMay,
  state: "visible" | "moderated" | "deleted",
) {
  if (state === "deleted") return may.restoreDeleted;
  if (state === "moderated") return may.restoreWaiting;
  return false;
}
