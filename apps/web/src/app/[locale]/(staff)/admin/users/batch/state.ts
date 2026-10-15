// What the batch update's form (a client component) and its server action share. No runtime import
// of the contracts: the form reaches the browser.

// The changes the form offers, in the order of its list.
export const BATCH_ACTIONS = [
  "setGroup",
  "addGroup",
  "removeGroup",
  "setTitle",
  "removeAvatar",
  "removeSignature",
  "ban",
  "liftBans",
  "delete",
] as const;
export type BatchActionName = (typeof BATCH_ACTIONS)[number];

// The changes that ask for the staff member's own password, and those that cannot be undone and
// ask for a reason and a confirmation.
export const GROUP_ACTIONS = ["setGroup", "addGroup", "removeGroup"] as const;
export const NEEDS_PASSWORD = [...GROUP_ACTIONS, "delete"] as const;
export const DESTRUCTIVE = ["ban", "delete"] as const;

export const isOneOf = <T extends string>(
  list: readonly T[],
  value: string,
): value is T => (list as readonly string[]).includes(value);

// Who a preview found: the ids a change is then applied to (the run acts on exactly these), how
// many, the first names, the words of a list that matched nobody, and where a criteria run
// resumes (null when nothing may follow).
export type Preview = {
  ids: number[];
  count: number;
  names: string[];
  unknown: string[];
  next: number | null;
};

export type Outcome = {
  name: string;
  status: "done" | "skipped" | "failed";
  message: string | null;
};

export type Result = {
  items: Outcome[];
  done: number;
  skipped: number;
  failed: number;
};

// What the action answers. A refusal is `error` (or `fields`, under the control it is about); a
// preview or a result is shown under the form. The form keeps what was typed.
export type BatchState = {
  error?: string;
  fields?: Record<string, string>;
  preview?: Preview;
  result?: Result;
} | null;

// The first names a preview lists; the count says the rest.
export const PREVIEW_NAMES = 20;
