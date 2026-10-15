import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/app/[locale]/(auth)/register/register-form";
import { Logo } from "@/components/layout/logo";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { referrerOf } from "@/lib/referral/link";
import { turnstileKeyFor } from "@/lib/sermo/turnstile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");
  return {
    title: t("metaTitle"),
  };
}

export default async function RegisterPage({
  searchParams,
}: PageProps<"/[locale]/register">) {
  const [t, { ref }, turnstileKey] = await Promise.all([
    getTranslations("auth.register"),
    searchParams,
    turnstileKeyFor("register"),
  ]);
  return (
    <main className="relative isolate flex min-h-dvh flex-1 items-center justify-center px-4 py-8">
      <PageBackdrop />
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border bg-background md:min-h-[36rem] md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-muted p-8 md:flex">
          <Logo />
        </div>
        <div className="flex flex-col p-4 sm:p-8">
          <div className="flex items-center justify-between md:justify-end">
            <Logo className="md:hidden" />
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-md px-2 text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("login")}
            </Link>
          </div>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-6">
            <h1 className="text-center text-2xl font-bold tracking-tight">
              {t("heading")}
            </h1>
            <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">
              {t("description")}
            </p>
            <RegisterForm
              referrer={referrerOf(ref)?.toString()}
              turnstileKey={turnstileKey}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
