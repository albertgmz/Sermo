import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthShell } from "@/app/(auth)/auth-shell";
import { ForgotForm } from "@/app/(auth)/forgot-password/forgot-form";
import { ForgotSkeleton } from "@/app/(auth)/forgot-password/forgot-skeleton";
import { mailAvailable } from "@/lib/sermo/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("metaTitle") };
}

const linkClass =
  "inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline";

async function ForgotBody({
  searchParams,
}: {
  searchParams: PageProps<"/forgot-password">["searchParams"];
}) {
  // What the backend can do is asked at request time, never baked into the prerendered page.
  await connection();
  const [t, { sent }, mail] = await Promise.all([
    getTranslations("auth.forgotPassword"),
    searchParams,
    mailAvailable(),
  ]);
  const message = !mail ? t("unavailable") : sent ? t("sent") : null;
  if (message) {
    return (
      <div className="space-y-2 text-center">
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
        <Link href="/login" className={linkClass}>
          {t("backToLogin")}
        </Link>
      </div>
    );
  }
  return (
    <>
      <p className="mb-4 text-center text-sm text-muted-foreground">
        {t("description")}
      </p>
      <ForgotForm />
      <p className="mt-4 text-center text-sm">
        <Link href="/login" className={linkClass}>
          {t("backToLogin")}
        </Link>
      </p>
    </>
  );
}

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  const t = await getTranslations("auth.forgotPassword");
  return (
    <AuthShell heading={t("heading")}>
      <Suspense fallback={<ForgotSkeleton />}>
        <ForgotBody searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
