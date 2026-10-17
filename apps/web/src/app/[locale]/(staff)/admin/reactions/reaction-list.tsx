import { reactionTypesList } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { ItemList, RowLink, RowToggle } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { asType, withoutBlockedPictures } from "@/lib/sermo/reactions";
import { setReactionTypeActive } from "./actions";

// Every reaction type in the backend's display order, inactive ones included: its picture or
// emoji, its label leading to its edit page, its score and what limits it, and the switch that
// offers it or stops offering it (after a confirm step).
export async function ReactionList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
  // The "Add reaction" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, format, { items }] = await Promise.all([
    getTranslations("adminContent.reactions"),
    getFormatter(),
    read(reactionTypesList, {}),
  ]);
  // What a visitor would see: a picture LITE blocks is the emoji here too.
  const shown = (await withoutBlockedPictures(items)).map(asType);
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          ordered: t("notices.ordered"),
          activated: t("notices.activated"),
          deactivated: t("notices.deactivated"),
        }}
      />
      <ItemList
        label={t("list.heading")}
        heading={t("list.heading")}
        description={t("list.description")}
        empty={{
          title: t("list.emptyTitle"),
          description: t("list.emptyDescription"),
          action: addAction,
        }}
        items={items.map((item, index) => {
          const limits = [
            item.frames && item.frames.count > 1
              ? t("list.animated", { count: item.frames.count })
              : item.image && t("list.picture"),
            item.forumIds.length > 0 &&
              t("list.forums", { count: item.forumIds.length }),
            item.rule && item.rule.conditions.length > 0 && t("list.rule"),
          ].filter(Boolean);
          return {
            id: item.id,
            icon: (
              <ReactionPicture
                emoji={item.emoji}
                picture={shown[index].picture}
                className="text-2xl"
              />
            ),
            title: item.title,
            href: `/admin/reactions/${item.id}`,
            description: limits.length > 0 ? limits.join(" · ") : undefined,
            badges: (
              <>
                <Badge
                  variant={
                    item.score > 0
                      ? "success"
                      : item.score < 0
                        ? "destructive"
                        : "secondary"
                  }
                  className="tabular-nums"
                >
                  <span className="sr-only">{t("list.score")} </span>
                  {format.number(item.score, { signDisplay: "exceptZero" })}
                </Badge>
                {!item.isActive && (
                  <Badge variant="outline">{t("list.inactive")}</Badge>
                )}
              </>
            ),
            toggle: (
              <RowToggle
                action={setReactionTypeActive}
                fields={{ id: String(item.id) }}
                checked={item.isActive}
                label={t("list.toggle", { title: item.title })}
                confirm={{
                  warning: item.isActive
                    ? t("list.deactivateWarning")
                    : t("list.activateWarning"),
                  submit: item.isActive
                    ? t("list.deactivate")
                    : t("list.activate"),
                  danger: item.isActive,
                }}
              />
            ),
            actions: (
              <RowLink
                href={`/admin/reactions/${item.id}`}
                label={t("list.edit", { title: item.title })}
              />
            ),
          };
        })}
      />
    </>
  );
}
