import { useTranslations } from "next-intl";
import { LITE_CATEGORIES, type LiteState } from "@/lib/lite-preferences";

export function LiteStatus({ state }: { state: LiteState }) {
  const t = useTranslations("lite.status");
  return state.master
    ? t("on")
    : state.blocked.length
      ? t("partial", {
          count: state.blocked.length,
          total: LITE_CATEGORIES.length,
        })
      : t("off");
}
