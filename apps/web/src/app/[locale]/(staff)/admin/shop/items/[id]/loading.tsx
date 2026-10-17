import { useTranslations } from "next-intl";
import { EditFormSkeleton, LoadingPage } from "../../../../skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.items");
  return (
    <LoadingPage label={t("loading")}>
      <EditFormSkeleton rows={7} advanced={1} />
    </LoadingPage>
  );
}
