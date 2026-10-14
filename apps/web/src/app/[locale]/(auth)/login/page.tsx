import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { LoginForm } from "@/app/[locale]/(auth)/login/login-form";
import { ResendForm } from "@/app/[locale]/(auth)/resend-form";
import { safeReturnPath } from "@/lib/sermo/return-path";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return {
    title: t("metaTitle"),
  };
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/[locale]/login">) {
  const t = await getTranslations("auth.login");
  const resend = await getTranslations("auth.resendForm");
  const { next, registered, reset, resent } = await searchParams;
  return (
    <AuthShell heading={t("heading")}>
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
    </AuthShell>
  );
}
