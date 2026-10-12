import "server-only";

import type { AuthorView, MemberView } from "./views";

// The only file that decides how a member is drawn next to content. Today it is built from the
// `{ id, username }` summary that every backend item carries; when the batched member reads
// (`users.cards`, `users.authors`) arrive, only the bodies of the two functions below change and
// every screen keeps calling them once per render with all the members it shows.

export type MemberRef = { id: number; username: string };

function unique(refs: Iterable<MemberRef>): Map<number, MemberRef> {
  const byId = new Map<number, MemberRef>();
  for (const ref of refs) byId.set(ref.id, ref);
  return byId;
}

function plainMember({ id, username }: MemberRef): MemberView {
  return {
    id,
    username,
    avatar: null,
    frame: null,
    nameColor: null,
    title: "",
    badges: [],
    level: 1,
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
  const views = new Map<number, MemberView>();
  for (const [id, ref] of unique(refs)) views.set(id, plainMember(ref));
  return lookup(views, "member");
}

export async function authorsFor(
  refs: Iterable<MemberRef>,
): Promise<(id: number) => AuthorView> {
  const views = new Map<number, AuthorView>();
  for (const [id, ref] of unique(refs)) {
    views.set(id, {
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
    });
  }
  return lookup(views, "author");
}
