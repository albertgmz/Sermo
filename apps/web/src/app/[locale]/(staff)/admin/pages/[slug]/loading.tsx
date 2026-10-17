import { useTranslations } from "next-intl";
import { FormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminContent.pageEdit");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
