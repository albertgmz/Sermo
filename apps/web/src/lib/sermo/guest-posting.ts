import "server-only";

import { nodesGet } from "@sermo/core/contracts";
import { read } from "./client";
import { turnstileKeyFor } from "./turnstile";

type Resolved = Record<string, boolean | number>;

// What a forum asks of an account that a guest cannot have: such a forum takes no guest posts.
type ForumRules = {
  isReadOnly: boolean;
  minAccountAgeDays: number;
  minPostCount: number;
};

// The Turnstile site key of the form a guest posts with when the visitor is offered the guest
// composer in this forum, else null: a guest (no one signed in) in a forum that allows guest posts
// (`forum.guestPost`) and asks no account of them, while the site guards the form, which is the
// only time the backend takes a guest post. The backend judges every post again.
export async function guestPostKey(
  signedIn: boolean,
  resolved: Resolved,
  rules?: ForumRules,
): Promise<string | null> {
  if (signedIn || resolved["forum.guestPost"] !== true) return null;
  if (
    rules &&
    (rules.isReadOnly || rules.minAccountAgeDays || rules.minPostCount)
  )
    return null;
  return turnstileKeyFor("guestPost");
}

// The same for a thread's reply box. The thread's own answer does not carry its forum's rules, so
// the forum is read, and only for a guest who holds the permission there.
export async function guestReplyKey(
  signedIn: boolean,
  resolved: Resolved,
  nodeId: number,
): Promise<string | null> {
  if (signedIn || resolved["forum.guestPost"] !== true) return null;
  const { node } = await read(nodesGet, { nodeId });
  return guestPostKey(signedIn, resolved, node.settings);
}
