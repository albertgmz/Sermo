import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  EmailSection,
  PasswordSection,
} from "@/app/[locale]/(main)/account/security/sections";
import { Sessions } from "@/app/[locale]/(main)/account/security/sessions";
import { SignInHistory } from "@/app/[locale]/(main)/account/security/sign-in-history";
import {
  EmailSkeleton,
  HistorySkeleton,
  PasswordSkeleton,
  SessionsSkeleton,
} from "@/app/[locale]/(main)/account/security/skeletons";
import { logout } from "@/app/[locale]/(main)/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.security");
  return { title: t("metaTitle") };
}

export default function SecurityPage({
  searchParams,
}: PageProps<"/[locale]/account/security">) {
  const t = useTranslations("account.security");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("devicesLoading")}>
            <SessionsSkeleton />
          </LoadingRegion>
        }
      >
        <Sessions searchParams={searchParams} />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("history.loading")}>
            <HistorySkeleton />
          </LoadingRegion>
        }
      >
        <SignInHistory />
      </Suspense>
      <Suspense fallback={<PasswordSkeleton />}>
        <PasswordSection searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<EmailSkeleton />}>
        <EmailSection searchParams={searchParams} />
      </Suspense>
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("logoutHeading")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("logoutDescription")}
        </p>
        <form action={logout} className="mt-3">
          <PendingButton variant="outline" className="min-h-10 px-4">
            {t("logout")}
          </PendingButton>
        </form>
      </section>
    </div>
  );
}
