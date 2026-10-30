import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { LoginForm } from "@/app/[locale]/(auth)/login/login-form";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";
import { ResendForm } from "@/app/[locale]/(auth)/resend-form";
import { socialRefusalText } from "@/app/[locale]/(auth)/social-refusal";
import { SocialSignIn } from "@/app/[locale]/(auth)/social-sign-in";
import { OneTapGate } from "@/components/layout/one-tap-gate";
import { safeReturnPath } from "@/lib/sermo/return-path";
import { getSite } from "@/lib/sermo/site";
import { getSocialSignIn } from "@/lib/sermo/social-sign-in";
import { turnstileKeyFor } from "@/lib/sermo/turnstile";

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
  const { next, registered, reset, resent, notMe, refused, form, error, via } =
    await searchParams;
  const [loginKey, resendKey, refusal, site, { providers }] = await Promise.all(
    [
      turnstileKeyFor("login"),
      registered ? turnstileKeyFor("resendConfirmation") : null,
      refusalText(refused),
      getSite(),
      getSocialSignIn(),
    ],
  );
  const back = safeReturnPath(next);
  // The refusal is the resend form's when that form was the one sent.
  const resendRefused = form === "resend";
  return (
    <AuthShell heading={t("heading")}>
      <Suspense>
        <OneTapGate next={back} />
      </Suspense>
      {(registered || reset || resent || notMe) && (
        <p
          role="status"
          className="mb-4 text-center text-sm text-muted-foreground"
        >
          {resent
            ? t("resentNotice")
            : reset
              ? t("resetNotice")
              : notMe
                ? t("notMeNotice")
                : t("registeredNotice")}
        </p>
      )}
      <SocialSignIn
        providers={providers}
        from="/login"
        next={back}
        refusal={await socialRefusalText(error, via, providers)}
      />
      <LoginForm
        next={back}
        turnstileKey={loginKey}
        {...(resendRefused ? {} : { refusal })}
      />
      {site.registration.open && (
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
      )}
      {registered && (
        <div className="mt-6 space-y-4 border-t pt-6">
          <h2 className="text-center text-sm font-semibold">
            {resend("heading")}
          </h2>
          <ResendForm
            from="login"
            turnstileKey={resendKey}
            refusal={resendRefused ? refusal : undefined}
          />
        </div>
      )}
    </AuthShell>
  );
}
