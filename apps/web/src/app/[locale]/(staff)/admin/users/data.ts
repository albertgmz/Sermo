import "server-only";

import {
  staffAdministrators,
  staffModerators,
  usersAdminGet,
} from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import { cache } from "react";
import type * as z from "zod";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";

export type AdminMember = z.output<typeof usersAdminGet.output>;

// The member as administration sees them, once per request (the layout and the tab share it).
export const getMember = cache(
  (userId: number): Promise<AdminMember> => read(usersAdminGet, { userId }),
);

// Whether the viewer holds a global permission, as `auth.me` resolved it. Only an ordering of the
// controls: the backend refuses what it does not allow.
export const holds = (
  viewer: { resolvedPermissions: Record<string, boolean | number> },
  id: string,
) => viewer.resolvedPermissions[id] === true;

// A read that the viewer may be refused: null for a refusal, so the page shows less instead of
// failing.
export async function ifAllowed<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SermoError &&
      (error.code === "forbidden" || error.code === "not_found")
    ) {
      return null;
    }
    throw error;
  }
}

// The staff roles of a member, from the two rosters (which need admin.permissions and hold at
// most 200 each, so a member past the cut shows no role).
export const staffRolesOf = cache(
  async (
    userId: number,
  ): Promise<{ moderator: boolean; administrator: boolean }> => {
    const [moderators, administrators] = await Promise.all([
      ifAllowed(() => call(staffModerators, {})),
      ifAllowed(() => call(staffAdministrators, {})),
    ]);
    return {
      moderator: Boolean(moderators?.items.some((i) => i.card.id === userId)),
      administrator: Boolean(
        administrators?.items.some((i) => i.card.id === userId),
      ),
    };
  },
);

// The member id of a tab's address; anything else is a 404.
export async function memberIdOf(
  params: Promise<{ id: string }>,
): Promise<number> {
  const userId = parseId((await params).id);
  if (userId === null) notFound();
  return userId;
}

// Whether every form on a tab is read-only: the member ranks at or above the viewer, or the
// account was erased. The backend refuses the writes anyway.
export const isReadOnly = (member: AdminMember) =>
  !member.canEdit || member.state === "erased";
