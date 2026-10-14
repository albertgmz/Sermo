import { useTranslations } from "next-intl";
import { PerksSkeleton } from "@/app/[locale]/(main)/account/permissions/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.perks");
  return (
    <LoadingRegion label={t("loading")}>
      <PerksSkeleton />
    </LoadingRegion>
  );
}
