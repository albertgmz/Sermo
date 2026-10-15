import { useTranslations } from "next-intl";
import type { LiteState } from "@/lib/lite-preferences";

export function LiteStatus({ state }: { state: LiteState }) {
  const t = useTranslations("lite.status");
  return state.master
    ? t("on")
    : state.blocked.length
      ? t("partial")
      : t("off");
}
