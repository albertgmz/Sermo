import { ShieldCheck } from "lucide-react";
import type { ComponentProps } from "react";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { ItemList, RowLink } from "@/components/staff/item-list";
import type { MemberView } from "@/lib/sermo/views";

type Card = ComponentProps<typeof UserLink>["user"] &
  ComponentProps<typeof UserAvatar>["user"] &
  Pick<MemberView, "title" | "badges">;

// The list of the staff screens: one row per member with a link to their permissions, and under
// it what the page says about them (`detail`), or an empty state when nobody is listed.
export function StaffList<Item extends { card: Card & { id: number } }>({
  items,
  heading,
  permissions,
  empty,
  detail,
}: {
  items: readonly Item[];
  heading: string;
  permissions: (name: string) => string;
  empty: { title: string; description: string };
  detail: (item: Item) => React.ReactNode;
}) {
  return (
    <ItemList
      label={heading}
      empty={empty}
      items={items.map((item) => ({
        id: item.card.id,
        icon: <UserAvatar user={item.card} size="lg" />,
        title: (
          <UserLink
            user={item.card}
            className="-my-2.5 max-w-full truncate py-2.5 text-sm"
          />
        ),
        badges: <UserBadges user={item.card} />,
        description: item.card.title,
        actions: (
          <RowLink
            href={`/admin/permissions/members/${item.card.id}`}
            label={permissions(item.card.username)}
            icon={<ShieldCheck />}
          />
        ),
        panel: detail(item),
      }))}
    />
  );
}
