import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";
import { RegisterForm } from "@/app/[locale]/(auth)/register/register-form";
import { referrerOf } from "@/lib/referral/link";
import { isPublished } from "@/lib/sermo/pages";
import { getSite } from "@/lib/sermo/site";
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
  const [t, { ref, refused }, turnstileKey, hasTerms, hasRules, site] =
    await Promise.all([
      getTranslations("auth.register"),
      searchParams,
      turnstileKeyFor("register"),
      isPublished("terms"),
      isPublished("rules"),
      getSite(),
    ]);
  const { registration } = site;
  const refusal = await refusalText(refused);
  // What the checkbox names: only the pages the site publishes.
  const pages =
    hasTerms && hasRules
      ? "both"
      : hasTerms
        ? "terms"
        : hasRules
          ? "rules"
          : "none";
  return (
    <AuthShell heading={t("heading")}>
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
