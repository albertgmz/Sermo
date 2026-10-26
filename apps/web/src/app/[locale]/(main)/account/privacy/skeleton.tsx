import { useTranslations } from "next-intl";
import { SectionSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { MemberRowSkeleton } from "@/components/forum/skeletons";

export function PrivacySkeleton() {
  const t = useTranslations("account.privacy");
  return (
    <div className="space-y-4">
      <SectionSkeleton
        heading={t("sectionHeading")}
        description={t("sectionDescription")}
        rows={2}
      />
      <section className="min-w-0 rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("blockedHeading")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("blockedDescription")}
          </p>
        </div>
        <div className="divide-y">
          {[1, 2, 3].map((row) => (
            <MemberRowSkeleton key={row} className="p-4" />
          ))}
        </div>
      </section>
    </div>
  );
}
