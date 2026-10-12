import { useTranslations } from "next-intl";
import {
  EmailSkeleton,
  PasswordSkeleton,
  SessionsSkeleton,
} from "@/app/(main)/account/security/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const t = useTranslations("account.loading");
  return (
    <LoadingRegion label={t("securityLabel")}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("securityHeading")}
        </h1>
        <SessionsSkeleton />
        <PasswordSkeleton />
        <EmailSkeleton />
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">{t("logoutHeading")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("logoutDescription")}
          </p>
          <Skeleton className="mt-3 h-10 w-20" />
        </section>
      </div>
    </LoadingRegion>
  );
}
