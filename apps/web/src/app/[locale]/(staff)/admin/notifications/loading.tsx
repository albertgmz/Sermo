import { useTranslations } from "next-intl";
import { FormSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  const t = useTranslations("adminCommunication.notifications");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={8} />
    </LoadingPage>
  );
}
