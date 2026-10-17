import { useTranslations } from "next-intl";
import { EditFormLoading } from "../../credits/skeletons";

export default function Loading() {
  const t = useTranslations("adminEconomy.awards");
  return <EditFormLoading label={t("loading")} rows={7} advanced />;
}
