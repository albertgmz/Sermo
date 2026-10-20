import { useTranslations } from "next-intl";
import { EditFormSkeleton, LoadingPage } from "../../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.awardCategories");
  return (
    <LoadingPage label={t("loading")}>
      <EditFormSkeleton rows={2} />
    </LoadingPage>
  );
}
