import { useTranslations } from "next-intl";
import { PrivacySkeleton } from "@/app/(main)/account/privacy/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.privacy");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <PrivacySkeleton />
      </div>
    </LoadingRegion>
  );
}
