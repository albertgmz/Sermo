import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { NotMeForm } from "@/app/[locale]/(auth)/not-me/not-me-form";
import { refusalText } from "@/app/[locale]/(auth)/refusal-text";

// The address carries the token: it must not travel on in a Referer header.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.notMe");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default async function NotMePage({
  searchParams,
}: PageProps<"/[locale]/not-me">) {
  const [t, { token, error, refused }] = await Promise.all([
    getTranslations("auth.notMe"),
    searchParams,
  ]);
  const value = typeof token === "string" && !error ? token : undefined;
  if (!value) {
    return (
      <AuthShell heading={t("invalidHeading")}>
        <div className="space-y-2 text-center">
          <p role="alert" className="text-sm text-muted-foreground">
            {t("invalid")}
          </p>
          <Link
            href="/login?next=%2Faccount%2Fsecurity%23password"
            className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("signIn")}
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
      <NotMeForm token={value} refusal={await refusalText(refused)} />
    </AuthShell>
  );
}
