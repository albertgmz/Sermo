import type { ActionFormState } from "@/components/forum/action-form";

// What a forum's batch change shares between the bar (a client component) and its server action.
// The most threads one batch takes (the backend's limit).
export const BATCH_LIMIT = 100;

export const BATCH_ACTIONS = [
  "lock",
  "unlock",
  "stick",
  "unstick",
  "feature",
  "unfeature",
  "delete",
  "restore",
  "move",
  "setPrefix",
] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

// What the action answers: a refusal, or that the batch went through with a line saying how.
export type BatchState = ActionFormState & { summary?: string };

// The changes a viewer's permissions in a forum offer for its threads, from the forum's resolved
// permissions. A display hint: the backend judges every thread of a batch again.
export function batchActionsFor(
  resolved: Record<string, boolean | number>,
): BatchAction[] {
  const flag = (key: string) => resolved[key] === true;
  const may: Record<BatchAction, boolean> = {
    lock: flag("forum.lock"),
    unlock: flag("forum.lock"),
    stick: flag("forum.stick"),
    unstick: flag("forum.stick"),
    feature: flag("forum.feature"),
    unfeature: flag("forum.feature"),
    delete: flag("forum.deleteAny"),
    restore: flag("forum.undelete") || flag("forum.approve"),
    move: flag("forum.move"),
    setPrefix: flag("forum.editAny"),
  };
  return BATCH_ACTIONS.filter((action) => may[action]);
}
