import "server-only";

import { usersAuthors, usersCards } from "@sermo/core/contracts";
import type * as z from "zod";
import { call } from "./client";
import type { AuthorView, MemberView } from "./views";

// The only file that decides how a member is drawn next to content. Every backend item carries
// the `{ id, username }` summary of its members; a screen collects the ones it shows and asks
// here once per render. A member the backend no longer knows keeps the name the item carried.

export type MemberRef = { id: number; username: string };

type Card = z.output<typeof usersCards.output>["items"][number];
type Author = z.output<typeof usersAuthors.output>["items"][number];

function unique(refs: Iterable<MemberRef>): Map<number, MemberRef> {
  const byId = new Map<number, MemberRef>();
  for (const ref of refs) byId.set(ref.id, ref);
  return byId;
}

function chunks(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function plainMember({ id, username }: MemberRef): MemberView {
  return {
    id,
    username,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: true,
  };
}

export function plainAuthor(ref: MemberRef): AuthorView {
  return {
    member: plainMember(ref),
    cover: null,
    joinedAt: "",
    postCount: 0,
    reactionScore: 0,
    xp: 0,
    currentLevelXp: 0,
    nextLevelXp: 0,
    awards: [],
    signatureHtml: null,
  };
}

const memberView = (card: Card): MemberView => card;

function authorView(author: Author): AuthorView {
  return {
    member: memberView(author.card),
    cover: author.cover && { url: author.cover.url },
    joinedAt: author.createdAt,
    postCount: author.postCount,
    reactionScore: author.reactionScore,
    xp: author.awardXp,
    currentLevelXp: author.currentLevelXp,
    nextLevelXp: author.nextLevelXp,
    awards: author.awards.map(({ id, name, icon, tier }) => ({
      id,
      name,
      icon,
      tier,
    })),
    signatureHtml: author.signatureHtml,
  };
}

function lookup<T>(views: Map<number, T>, what: string): (id: number) => T {
  return (id) => {
    const view = views.get(id);
    if (!view)
      throw new Error(`The ${what} ${id} was not collected for this page.`);
    return view;
  };
}

export async function membersFor(
  refs: Iterable<MemberRef>,
): Promise<(id: number) => MemberView> {
  const wanted = unique(refs);
  const views = new Map<number, MemberView>();
  for (const [id, ref] of wanted) views.set(id, plainMember(ref));
  const pages = await Promise.all(
    chunks([...wanted.keys()], 100).map((userIds) =>
      call(usersCards, { userIds }),
    ),
  );
  for (const { items } of pages)
    for (const card of items) views.set(card.id, memberView(card));
  return lookup(views, "member");
}

export async function authorsFor(
  refs: Iterable<MemberRef>,
): Promise<(id: number) => AuthorView> {
  const wanted = unique(refs);
  const views = new Map<number, AuthorView>();
  for (const [id, ref] of wanted) views.set(id, plainAuthor(ref));
  const pages = await Promise.all(
    chunks([...wanted.keys()], 50).map((userIds) =>
      call(usersAuthors, { userIds }),
    ),
  );
  for (const { items } of pages)
    for (const author of items) views.set(author.card.id, authorView(author));
  return lookup(views, "author");
}
