import { useTranslations } from "next-intl";
import { FormSkeleton, ListSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.adjust");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={2} />
      <ListSkeleton />
    </LoadingPage>
  );
}
