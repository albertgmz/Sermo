import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCollage } from "@/app/(auth)/login/auth-collage";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { ResendForm } from "@/app/(auth)/resend-form";
import { LogoMark } from "@/components/layout/logo";
import { safeReturnPath } from "@/lib/sermo/return-path";
import { getSite } from "@/lib/sermo/site";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return {
    title: t("metaTitle"),
  };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations("auth.login");
  const resend = await getTranslations("auth.resendForm");
  const [{ next, registered, reset, resent }, site] = await Promise.all([
    searchParams,
    getSite(),
  ]);
  return (
    <main className="grid min-h-dvh flex-1 md:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link
            href="/"
            aria-label={t("aria.home", { site: site.name })}
            className="mx-auto flex size-12 items-center justify-center rounded-md"
          >
            <LogoMark className="size-9" />
          </Link>
          <h1 className="mt-3 mb-8 text-center text-3xl font-bold tracking-tight">
            {t("heading")}
          </h1>
          {(registered || reset || resent) && (
            <p
              role="status"
              className="mb-4 text-center text-sm text-muted-foreground"
            >
              {resent
                ? t("resentNotice")
                : reset
                  ? t("resetNotice")
                  : t("registeredNotice")}
            </p>
          )}
          <LoginForm next={safeReturnPath(next)} />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t.rich("createAccount", {
              link: (chunks) => (
                <Link
                  href="/register"
                  className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
          {registered && (
            <div className="mt-6 space-y-4 border-t pt-6">
              <h2 className="text-center text-sm font-semibold">
                {resend("heading")}
              </h2>
              <ResendForm from="login" />
            </div>
          )}
        </div>
      </div>
      <AuthCollage className="hidden md:block" />
    </main>
  );
}
