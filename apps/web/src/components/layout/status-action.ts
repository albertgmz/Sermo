"use server";

import { profilePostsCreate } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { attempt } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

export type StatusState = { error?: string; posted?: boolean };

// "Update your status": a post on the signed-in member's own wall. The wall is the member's, never
// a field of the form. The backend decides whether they may post there and how long it may be, and
// its refusal is shown as it comes.
export async function postStatus(
  _previous: StatusState,
  formData: FormData,
): Promise<StatusState> {
  const { user } = await getViewer();
  if (!user) redirect("/login");
  const body = String(formData.get("body") ?? "");
  const created = await attempt("/", () =>
    call(profilePostsCreate, { userId: user.id, body, attachmentIds: [] }),
  );
  return created.ok ? { posted: true } : { error: created.error };
}
