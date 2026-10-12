import { useTranslations } from "next-intl";
import { PreferencesSkeleton } from "@/app/(main)/account/preferences/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.preferences");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <PreferencesSkeleton />
      </div>
    </LoadingRegion>
  );
}
