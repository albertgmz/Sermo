import { reactionTypesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { asType, withoutBlockedPictures } from "@/lib/sermo/reactions";
import { EditFormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { forumChoices } from "../access-fields";
import { updateReactionType } from "../actions";
import { ReactionFields } from "../reaction-fields";

type Params = PageProps<"/[locale]/admin/reactions/[id]">["params"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions.edit");
  return { title: t("metaTitle") };
}

// The type by its id among all of them (the backend reads them only as a list).
async function EditReaction({ params }: { params: Params }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [{ items }, forums] = await Promise.all([
    read(reactionTypesList, {}),
    forumChoices(),
  ]);
  const type = items.find((item) => item.id === id);
  if (!type) notFound();
  // What a visitor would see: a picture LITE blocks is the emoji here too.
  const [shown] = await withoutBlockedPictures([type]);
  return (
    <EditForm action={updateReactionType}>
      <input type="hidden" name="id" value={type.id} />
      <ReactionFields
        type={type}
        forums={forums}
        current={
          type.image ? (
            <ReactionPicture
              emoji={type.emoji}
              picture={asType(shown).picture}
              label={type.title}
              className="text-3xl"
            />
          ) : undefined
        }
      />
    </EditForm>
  );
}

export default function EditReactionPage({
  params,
}: PageProps<"/[locale]/admin/reactions/[id]">) {
  const t = useTranslations("adminContent.reactions");
  return (
    <ScreenFrame
      heading={t("edit.heading")}
      subtitle={t("edit.description")}
      trail={params.then(({ id }) => staffTrail(`/admin/reactions/${id}`))}
      label={t("loading")}
      fallback={<EditFormSkeleton advanced={2} />}
    >
      <EditReaction params={params} />
    </ScreenFrame>
  );
}
