import { io } from "next/cache";
import { getTranslations } from "next-intl/server";
import { menuAccountLinks } from "@/app/[locale]/(main)/account/links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { getCounters, getViewerCard } from "@/components/layout/header-data";
import {
  AlertsFooter,
  BookmarksFooter,
  ConversationsFooter,
} from "@/components/layout/header-panels";
import { InboxPanel } from "@/components/layout/inbox-panel";
import { accountItems } from "@/components/layout/nav";
import { toNavItems } from "@/components/layout/nav-server";
import "@/components/layout/panel-parts";
import { UserMenu } from "@/components/layout/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getLiteState } from "@/lib/lite-mode";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

// The signed-in member's own corner of the header, shared by the site header and the staff panel's
// top bar: the Messages and Alerts buttons, each with its unread count and its panel, then the
// avatar, which opens the account menu (account links and bookmarks). Nothing for a guest.
// `inboxClassName` hides the two buttons where something else holds them (the phone bar).
export async function AccountMenu({
  inboxClassName,
}: {
  inboxClassName?: string;
}) {
  const [viewer, card, unread, navigation, account, lite] = await Promise.all([
    getViewer(),
    getViewerCard(),
    getCounters(),
    getNavigation(),
    getTranslations("account.navigation"),
    getTranslations("lite.navigation"),
  ]);
  if (!viewer.user || !card) return null;
  await io();
  const links = accountItems(
    toNavItems(navigation.account, `/members/${viewer.user.id}`),
  );
  const screenLinks = menuAccountLinks(links.map((link) => link.href)).map(
    ({ href, label }) => ({
      href,
      label: label ? account(label) : lite("label"),
    }),
  );
  return (
    <>
      <InboxPanel
        kind="conversations"
        unread={unread.conversations}
        footer={<ConversationsFooter />}
        className={inboxClassName}
      />
      <InboxPanel
        kind="alerts"
        unread={unread.notifications}
        footer={<AlertsFooter />}
        className={inboxClassName}
      />
      <UserMenu
        lite={await getLiteState()}
        triggerAvatar={<UserAvatar user={card} size="md" link={false} eager />}
        avatar={<UserAvatar user={card} size="lg" link={false} />}
        links={links}
        screenLinks={screenLinks}
        user={{ username: card.username, title: card.title }}
        footers={{ bookmarks: <BookmarksFooter /> }}
        status={
          viewer.permissions.canPostProfile
            ? { wallHref: `/members/${viewer.user.id}` }
            : undefined
        }
      />
    </>
  );
}

// The member's corner while it streams in: the same three slots (Messages, Alerts, the avatar
// button with its arrow), shown at the same widths, so nothing beside it moves when it arrives.
export function AccountMenuSkeleton({
  inboxClassName,
}: {
  inboxClassName?: string;
}) {
  return (
    <>
      <Skeleton className={cn("size-10", inboxClassName)} />
      <Skeleton className={cn("size-10", inboxClassName)} />
      <Skeleton className="h-10 w-16" />
    </>
  );
}
