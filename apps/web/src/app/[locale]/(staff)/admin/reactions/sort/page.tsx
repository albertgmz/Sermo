import { reactionTypesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { SortForm } from "@/components/staff/sort-form";
import { read } from "@/lib/sermo/client";
import { asType, withoutBlockedPictures } from "@/lib/sermo/reactions";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { saveReactionOrder } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions.sort");
  return { title: t("metaTitle") };
}

// Every type in the order members are offered them, written through the order action, which saves
// only the types whose position changed.
async function ReactionOrder() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminContent.reactions"),
    read(reactionTypesList, {}),
  ]);
  if (items.length === 0)
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          title={t("sort.emptyTitle")}
          description={t("sort.emptyDescription")}
        />
      </div>
    );
  // What a visitor would see: a picture LITE blocks is the emoji here too.
  const shown = (await withoutBlockedPictures(items)).map(asType);
  return (
    <SortForm
      action={saveReactionOrder}
      name="position.{id}"
      heading={t("sort.list")}
      items={items.map((item, index) => ({
        id: item.id,
        title: item.title,
        position: item.position,
        icon: (
          <ReactionPicture
            emoji={item.emoji}
            picture={shown[index].picture}
            className="text-2xl"
          />
        ),
        description: item.isActive ? undefined : t("list.inactive"),
      }))}
    />
  );
}

export default function SortReactionsPage() {
  const t = useTranslations("adminContent.reactions");
  return (
    <ScreenFrame
      heading={t("sort.heading")}
      subtitle={t("sort.description")}
      trail={staffTrail("/admin/reactions/sort")}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <ReactionOrder />
    </ScreenFrame>
  );
}
