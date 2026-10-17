import { useTranslations } from "next-intl";
import { LoadingPage } from "../../../skeletons";
import { ListSkeleton } from "../../groups/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.items");
  return (
    <LoadingPage label={t("loading")}>
      <ListSkeleton rows={6} />
    </LoadingPage>
  );
}
