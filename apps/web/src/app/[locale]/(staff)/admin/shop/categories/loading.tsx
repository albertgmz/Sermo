import { useTranslations } from "next-intl";
import { ListLoading } from "../../credits/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.categories");
  return <ListLoading label={t("loading")} />;
}
