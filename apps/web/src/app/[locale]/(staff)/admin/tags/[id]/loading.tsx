import { useTranslations } from "next-intl";
import { LoadingPage } from "../../../skeletons";
import { FormSkeleton } from "../../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.tags");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={2} />
      <FormSkeleton rows={2} />
    </LoadingPage>
  );
}
