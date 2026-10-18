import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { DeleteAccountSection } from "@/app/[locale]/(main)/account/security/delete-account";
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
import { LoadingRegion } from "@/components/forum/skeletons";
import { SignOutForm } from "@/components/layout/sign-out-form";
import { Button } from "@/components/ui/button";

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
        <SignOutForm className="mt-3">
          <Button type="submit" variant="outline" className="min-h-10 px-4">
            {t("logout")}
          </Button>
        </SignOutForm>
      </section>
      {/* No fallback: the section is drawn only for a member whose groups allow it. */}
      <Suspense fallback={null}>
        <DeleteAccountSection />
      </Suspense>
    </div>
  );
}
