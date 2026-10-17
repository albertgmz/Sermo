import { useTranslations } from "next-intl";
import { EditFormSkeleton, LoadingPage } from "../../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.categories");
  return (
    <LoadingPage label={t("loading")}>
      <EditFormSkeleton rows={3} advanced={1} />
    </LoadingPage>
  );
}
