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
import { accountItems } from "@/components/layout/nav";
import { toNavItems } from "@/components/layout/nav-server";
import { UserMenu } from "@/components/layout/user-menu";
import { getLiteState } from "@/lib/lite-mode";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";

// The signed-in member's own menu, shared by the site header and the staff panel's top bar:
// alerts, conversations, account links and bookmarks behind the avatar. Nothing for a guest.
export async function AccountMenu() {
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
    <UserMenu
      lite={await getLiteState()}
      triggerAvatar={<UserAvatar user={card} size="md" link={false} />}
      avatar={<UserAvatar user={card} size="lg" link={false} />}
      links={links}
      screenLinks={screenLinks}
      user={{ username: card.username, title: card.title }}
      unread={{
        notifications: unread.notifications,
        conversations: unread.conversations,
      }}
      footers={{
        alerts: <AlertsFooter unread={unread.notifications} />,
        conversations: <ConversationsFooter />,
        bookmarks: <BookmarksFooter />,
      }}
      status={
        viewer.permissions.canPostProfile
          ? { wallHref: `/members/${viewer.user.id}` }
          : undefined
      }
    />
  );
}
