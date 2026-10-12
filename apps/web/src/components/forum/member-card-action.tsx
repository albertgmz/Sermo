"use server";

import { awardsMember, profilesGet } from "@sermo/core/contracts";
import { MemberCard, MemberCardMinimal } from "@/components/forum/member-card";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { isRecordId } from "@/lib/sermo/ids";

// A profile the visitor may not open: private, missing, or behind a sign-in.
const CLOSED = ["not_found", "forbidden", "unauthenticated"];

// Renders the card of one member on the server, so the avatar and cover keep
// reading the LITE cookie. Only called once a card is first opened. A member whose profile the
// visitor cannot open gets a card with the name alone.
export async function loadMemberCard(id: number, name: string) {
  if (!isRecordId(id)) return null;
  try {
    const [profile, held] = await Promise.all([
      call(profilesGet, { userId: id }),
      call(awardsMember, { userId: id }),
    ]);
    return (
      <MemberCard
        user={{
          ...profile,
          awards: held.items.map(({ award }) => award),
        }}
        className="border-0 bg-transparent"
      />
    );
  } catch (error) {
    if (!(error instanceof SermoError) || !CLOSED.includes(error.code)) {
      throw error;
    }
    return <MemberCardMinimal name={name} />;
  }
}
