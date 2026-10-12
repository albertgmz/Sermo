import { useTranslations } from "next-intl";
import { AppearanceSkeleton } from "@/app/(main)/account/appearance/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.appearance");
  return (
    <LoadingRegion label={t("loading")}>
      <AppearanceSkeleton />
    </LoadingRegion>
  );
}
