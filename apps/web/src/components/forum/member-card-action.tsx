"use server";

import { MemberActions } from "@/components/forum/member-actions";
import { MemberCardMinimal } from "@/components/forum/member-card";
import { MemberCardProfileLink } from "@/components/forum/member-card-profile-link";
import { MemberCardScope } from "@/components/forum/member-card-scope";
import { Postbit } from "@/components/forum/postbit";
import { SermoError } from "@/lib/sermo/errors";
import { isRecordId } from "@/lib/sermo/ids";
import { authorsFor, relationsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";

// A profile the visitor may not open: private, missing, or behind a sign-in.
const CLOSED = ["not_found", "forbidden", "unauthenticated"];

// Renders the card of one member on the server, so the avatar and cover keep
// reading the LITE cookie. Only called once a card is first opened (and again after a follow or
// unfollow made from the card). The card is the postbit of the member with its actions and a link
// to the profile, in a scope that keeps its names plain links. A member whose profile the visitor
// cannot open gets a card with the name alone.
export async function loadMemberCard(id: number, name: string) {
  if (!isRecordId(id) || typeof name !== "string") return null;
  try {
    const viewer = await getViewer();
    const [author, relation] = await Promise.all([
      authorsFor([{ id, username: name }]),
      relationsFor(viewer.user?.id ?? null, [id]),
    ]);
    const { member } = author(id);
    // A member the backend did not answer for, or one the viewer may not see.
    if (member.restricted)
      return <MemberCardMinimal name={name} className="p-1" />;
    return (
      <MemberCardScope disabled>
        <Postbit
          author={author(id)}
          layout="column"
          actions={
            <>
              <MemberActions
                member={member}
                relation={relation(id)}
                form="labelled"
              />
              <MemberCardProfileLink id={id} />
            </>
          }
        />
      </MemberCardScope>
    );
  } catch (error) {
    if (!(error instanceof SermoError) || !CLOSED.includes(error.code)) {
      throw error;
    }
    return <MemberCardMinimal name={name} className="p-1" />;
  }
}
