import { getTranslations } from "next-intl/server";
import { UserAvatar } from "@/components/forum/user-avatar";
import { getViewerCard } from "@/components/layout/header-data";
import { accountItems, type LinkItem } from "@/components/layout/nav";
import { toNavItems } from "@/components/layout/nav-server";
import { UserMenu } from "@/components/layout/user-menu";
import { getLiteState } from "@/lib/lite-mode";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";

// Not an entry of the navigation data: the backend seeds none for bookmarks, so the menu adds it.
function bookmarksLink(title: string): LinkItem {
  return {
    id: -1,
    title,
    href: "/account/bookmarks",
    external: false,
    builtin: "account.bookmarks",
    icon: null,
    iconPosition: "before",
    iconNode: null,
    match: [],
    children: [],
  };
}

// The signed-in member's own menu, shared by the site header and the staff panel's top bar.
// Nothing for a guest.
export async function AccountMenu() {
  const [viewer, card, navigation, t] = await Promise.all([
    getViewer(),
    getViewerCard(),
    getNavigation(),
    getTranslations("layout.userMenu"),
  ]);
  if (!viewer.user || !card) return null;
  return (
    <UserMenu
      lite={await getLiteState()}
      avatar={<UserAvatar user={card} size="md" link={false} />}
      links={[
        ...accountItems(
          toNavItems(navigation.account, `/members/${viewer.user.id}`),
        ),
        bookmarksLink(t("bookmarks")),
      ]}
      user={{ username: card.username, title: card.title }}
    />
  );
}
