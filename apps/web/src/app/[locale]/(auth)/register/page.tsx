import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";
import { RegisterForm } from "@/app/[locale]/(auth)/register/register-form";
import { termsPages } from "@/app/[locale]/(auth)/register/terms-pages";
import { socialRefusalText } from "@/app/[locale]/(auth)/social-refusal";
import { SocialSignIn } from "@/app/[locale]/(auth)/social-sign-in";
import { OneTapGate } from "@/components/layout/one-tap-gate";
import { referrerOf } from "@/lib/referral/link";
import { getSite } from "@/lib/sermo/site";
import { getSocialSignIn } from "@/lib/sermo/social-sign-in";
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
  const [
    t,
    { ref, refused, error, via },
    turnstileKey,
    pages,
    site,
    { providers },
  ] = await Promise.all([
    getTranslations("auth.register"),
    searchParams,
    turnstileKeyFor("register"),
    termsPages(),
    getSite(),
    getSocialSignIn(),
  ]);
  const { registration } = site;
  const [refusal, socialRefusal] = await Promise.all([
    refusalText(refused),
    socialRefusalText(error, via, providers),
  ]);
  return (
    <AuthShell heading={t("heading")}>
      {/* Google's prompt for a visitor whose browser is signed in to Google, worded for a sign-up;
        a sign-in from it goes to the home page, as the form's does. */}
      <Suspense>
        <OneTapGate context="signup" next="/" />
      </Suspense>
      {registration.open ? (
        <>
          <p className="mb-6 -mt-3 text-center text-sm text-muted-foreground md:-mt-5">
            {t("description")}
          </p>
          {registration.approval && (
            <p
              role="note"
              className="mb-6 text-center text-sm text-muted-foreground"
            >
              {t("approvalNote")}
            </p>
          )}
          <SocialSignIn
            providers={providers}
            from="/register"
            next="/"
            refusal={socialRefusal}
          />
          <RegisterForm
            referrer={referrerOf(ref)?.toString()}
            turnstileKey={turnstileKey}
            pages={pages}
            fields={registration.fields}
            minimumAge={registration.minimumAge}
            {...(refusal ? { refusal } : {})}
          />
        </>
      ) : (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t("closed")}
        </p>
      )}
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t.rich("haveAccount", {
          link: (chunks) => (
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </AuthShell>
  );
}
