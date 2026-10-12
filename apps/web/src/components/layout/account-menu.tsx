import { UserAvatar } from "@/components/forum/user-avatar";
import { getViewerCard } from "@/components/layout/header-data";
import { accountItems, toNavItems } from "@/components/layout/nav";
import { UserMenu } from "@/components/layout/user-menu";
import { getLiteState } from "@/lib/lite-mode";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";

// The signed-in member's own menu, shared by the site header and the staff panel's top bar.
// Nothing for a guest.
export async function AccountMenu() {
  const [viewer, card, navigation] = await Promise.all([
    getViewer(),
    getViewerCard(),
    getNavigation(),
  ]);
  if (!viewer.user || !card) return null;
  return (
    <UserMenu
      lite={await getLiteState()}
      avatar={<UserAvatar user={card} size="md" link={false} />}
      links={accountItems(
        toNavItems(navigation.account, `/members/${viewer.user.id}`),
      )}
      user={{ username: card.username, title: card.title }}
    />
  );
}
