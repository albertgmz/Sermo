import "server-only";

import {
  appearanceGet,
  authCounters,
  conversationsList,
  notificationsList,
} from "@sermo/core/contracts";
import { cache } from "react";
import { notificationEntries } from "@/app/(main)/notifications/entries";
import type { AccentColors } from "@/components/layout/site-accent";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor, plainMember } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

export type UnreadCounts = { conversations: number; notifications: number };

const NONE: UnreadCounts = { conversations: 0, notifications: 0 };

// How many rows the header panels list: a short first page of the pages' own operations.
const CONVERSATIONS_SHOWN = 5;
const NOTIFICATIONS_SHOWN = 6;

// The header is on every page, so a refusal here (a group without the right to see its
// notifications, a backend that cannot be reached) leaves its piece empty instead of failing the
// page. Anything that is not an API error is passed on.
async function orElse<T, F>(
  fallback: F,
  run: () => Promise<T>,
): Promise<T | F> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return fallback;
  }
}

// One call per render, shared by the desktop header and the phone bar. A guest has none.
export const getCounters = cache(async (): Promise<UnreadCounts> => {
  const { user } = await getViewer();
  if (!user) return NONE;
  return orElse(NONE, () => call(authCounters, {}));
});

// The signed-in member as they are drawn everywhere: their card, asked for once per render and
// shared by the header, the account menu and anything else in the shell. A guest has none. When
// the card cannot be read the member is drawn from the name the viewer already carries.
export const getViewerCard = cache(async () => {
  const { user } = await getViewer();
  if (!user) return null;
  return orElse(plainMember(user), async () =>
    (await membersFor([user]))(user.id),
  );
});

// The accent the visitor sees: the one a member chose if the palette still offers it, else the
// palette's first. None when the palette is empty, which leaves the stylesheet's own.
export const getAccent = cache(async (): Promise<AccentColors | null> => {
  const [{ user }, { accents }] = await Promise.all([getViewer(), getSite()]);
  if (accents.length === 0) return null;
  const chosen = user
    ? await orElse(null, async () => (await call(appearanceGet, {})).accentId)
    : null;
  return accents.find((accent) => accent.id === chosen) ?? accents[0];
});

// What a panel shows when its list could not be read: no rows, so no member is ever asked for.
const NOBODY = (): never => {
  throw new Error("The panel is empty.");
};

export const getRecentConversations = cache(() =>
  orElse({ items: [], member: NOBODY }, async () => {
    const { items } = await call(conversationsList, {
      limit: CONVERSATIONS_SHOWN,
    });
    return {
      items,
      member: await membersFor(items.map((c) => c.lastMessage.user)),
    };
  }),
);

export const getRecentNotifications = cache(() =>
  orElse({ entries: [], member: NOBODY }, async () => {
    const { items } = await call(notificationsList, {
      limit: NOTIFICATIONS_SHOWN,
    });
    return notificationEntries(items);
  }),
);
