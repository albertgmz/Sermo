import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";
import { ResetForm } from "@/app/[locale]/(auth)/reset-password/reset-form";

// The address carries the reset token: it must not travel on in a Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/[locale]/reset-password">) {
  const [t, { token, error, refused }] = await Promise.all([
    getTranslations("auth.resetPassword"),
    searchParams,
  ]);
  // Better Auth sends a link that does not work back with `error=INVALID_TOKEN` and no token.
  const value = typeof token === "string" && !error ? token : undefined;
  if (!value) {
    return (
      <AuthShell heading={t("invalidHeading")}>
        <div className="space-y-2 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            {t("invalid")}
          </p>
          <Link
            href="/forgot-password"
            className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("requestNew")}
          </Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell heading={t("heading")}>
      <p className="mb-4 text-center text-sm text-muted-foreground">
        {t("description")}
      </p>
      <ResetForm token={value} refusal={await refusalText(refused)} />
    </AuthShell>
  );
}
