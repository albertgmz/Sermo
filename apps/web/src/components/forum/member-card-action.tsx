"use server";

import { MemberCard } from "@/components/forum/member-card";
import { getUserById } from "@/lib/db";

// Renders the card of one member on the server, so the avatar and cover keep
// reading the LITE cookie. Only called once a card is first opened.
export async function loadMemberCard(id: number) {
  if (!Number.isInteger(id)) return null;
  const user = await getUserById(id);
  if (!user) return null;
  return <MemberCard user={user} className="border-0 bg-transparent" />;
}
