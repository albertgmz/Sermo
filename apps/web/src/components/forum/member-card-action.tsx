"use server";

import { memberActionsOf } from "@/components/forum/member-actions";
import { MemberCardMinimal } from "@/components/forum/member-card";
import { MemberCardScope } from "@/components/forum/member-card-scope";
import { MemberTooltip } from "@/components/forum/member-tooltip";
import { activitiesFor } from "@/lib/sermo/activity";
import { SermoError } from "@/lib/sermo/errors";
import { isRecordId } from "@/lib/sermo/ids";
import { authorsFor, relationsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";

// A profile the visitor may not open: private, missing, or behind a sign-in.
const CLOSED = ["not_found", "forbidden", "unauthenticated"];

// Renders the card of one member on the server, so the avatar and cover keep
// reading the LITE cookie. Only called once a card is first opened (and again after a follow or
// unfollow made from the card). The card is laid out as XenForo's member tooltip, with the viewer's
// actions and the link to the profile, in a scope that keeps its names plain links. A member
// whose profile the visitor cannot open gets a card with the name alone.
export async function loadMemberCard(id: number, name: string) {
  if (!isRecordId(id) || typeof name !== "string") return null;
  try {
    const viewer = await getViewer();
    const [author, relation, activities] = await Promise.all([
      authorsFor([{ id, username: name }]),
      relationsFor(viewer.user?.id ?? null, [id]),
      activitiesFor([id]),
    ]);
    const { member, lastActivity } = author(id);
    // A member the backend did not answer for, or one the viewer may not see.
    if (member.restricted) return <MemberCardMinimal name={name} />;
    // The last seen line, with the page the member viewed within the hour when the viewer may know.
    const place = activities.get(id)?.place ?? null;
    return (
      <MemberCardScope disabled>
        <MemberTooltip
          author={{
            ...author(id),
            lastActivity: lastActivity && { ...lastActivity, place },
          }}
          actions={memberActionsOf(member, relation(id))}
        />
      </MemberCardScope>
    );
  } catch (error) {
    if (!(error instanceof SermoError) || !CLOSED.includes(error.code)) {
      throw error;
    }
    return <MemberCardMinimal name={name} />;
  }
}
