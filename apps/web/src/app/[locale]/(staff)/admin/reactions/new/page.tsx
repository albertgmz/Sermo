import { reactionTypesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { EditFormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { forumChoices } from "../access-fields";
import { createReactionType } from "../actions";
import { ReactionFields } from "../reaction-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions.create");
  return { title: t("metaTitle") };
}

// A new type starts after the last one.
async function NewReaction() {
  const [t, { items }, forums] = await Promise.all([
    getTranslations("adminContent.reactions.create"),
    read(reactionTypesList, {}),
    forumChoices(),
  ]);
  const last = items.reduce((most, item) => Math.max(most, item.position), 0);
  return (
    <EditForm action={createReactionType} submit={t("submit")}>
      <ReactionFields forums={forums} position={last + 1} />
    </EditForm>
  );
}

export default function NewReactionPage() {
  const t = useTranslations("adminContent.reactions");
  return (
    <ScreenFrame
      heading={t("create.heading")}
      subtitle={t("create.description")}
      trail={staffTrail("/admin/reactions/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton advanced={2} />}
    >
      <NewReaction />
    </ScreenFrame>
  );
}
