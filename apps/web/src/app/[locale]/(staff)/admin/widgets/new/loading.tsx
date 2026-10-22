import { useTranslations } from "next-intl";
import { FormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminWidgets.pages");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton />
    </LoadingPage>
  );
}
