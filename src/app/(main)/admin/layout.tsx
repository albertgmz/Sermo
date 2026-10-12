import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AdminNavigation } from "@/app/(main)/admin/navigation";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.layout");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
  };
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.layout");
  return (
    <>
      <Suspense>
        <AdminAccess />
      </Suspense>
      <PageHero title={t("title")} subtitle={t("subtitle")}>
        <Badge variant="secondary">
          <ShieldCheck aria-hidden="true" /> {t("access")}
        </Badge>
        <Badge variant="outline">{t("mode")}</Badge>
      </PageHero>
      <PageLayout mainClassName="space-y-4">
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingNavigation")}>
              <div className="grid grid-cols-2 border-b sm:flex">
                {[1, 2, 3, 4].map((item) => (
                  <div key={item} className="flex h-11 items-center px-3">
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            </LoadingRegion>
          }
        >
          <AdminNavigation />
        </Suspense>
        <p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          {t("description")}
        </p>
        {children}
      </PageLayout>
    </>
  );
}

async function AdminAccess() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  return null;
}
