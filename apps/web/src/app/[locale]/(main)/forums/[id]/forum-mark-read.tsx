import { CheckCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { markForumReadAction } from "@/app/[locale]/(main)/forums/actions";
import { ActionForm } from "@/components/forum/action-form";

// "Mark forum read" on a forum or category page: every thread whose last post is not newer than
// now counts as read. The backend keeps one marker per forum, so the length of the forum does not
// matter.
export async function ForumMarkRead({ nodeId }: { nodeId: number }) {
  const t = await getTranslations("forums.markRead");
  return (
    <ActionForm
      action={markForumReadAction.bind(null, nodeId)}
      done={t("done")}
      submit={
        <>
          <CheckCheck aria-hidden="true" />
          {t("forum")}
        </>
      }
    />
  );
}
