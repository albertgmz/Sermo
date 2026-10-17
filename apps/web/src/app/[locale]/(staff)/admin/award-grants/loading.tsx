import { useTranslations } from "next-intl";
import { LoadingPage } from "../../skeletons";
import { FormSkeleton, ListSkeleton } from "../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.grants");
  return (
    <LoadingPage label={t("loading")}>
      <FormSkeleton rows={2} />
      <ListSkeleton />
    </LoadingPage>
  );
}
