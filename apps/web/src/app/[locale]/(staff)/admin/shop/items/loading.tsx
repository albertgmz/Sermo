import { useTranslations } from "next-intl";
import { ListLoading } from "../../credits/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.items");
  return <ListLoading label={t("loading")} />;
}
