import { useTranslations } from "next-intl";
import { ApiIntro, KeyWarning } from "@/app/[locale]/(main)/account/api/intro";
import { KeySkeleton } from "@/app/[locale]/(main)/account/api/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.apiKeys");
  return (
    <LoadingRegion label={t("key.loading")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <ApiIntro />
        <KeyWarning />
        <KeySkeleton />
      </div>
    </LoadingRegion>
  );
}
