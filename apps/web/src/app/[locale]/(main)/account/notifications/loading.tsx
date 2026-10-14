import { useTranslations } from "next-intl";
import { SectionSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";

export default function Loading() {
  const t = useTranslations("account.notifications");
  return (
    <LoadingRegion label={t("loading")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <SectionSkeleton
          heading={t("sectionHeading")}
          description={t("sectionDescription")}
          rows={8}
        />
      </div>
    </LoadingRegion>
  );
}
