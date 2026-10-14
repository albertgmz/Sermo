import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/app/[locale]/(auth)/auth-shell";
import { ResendForm } from "@/app/[locale]/(auth)/resend-form";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentAccount } from "@/lib/sermo/auth";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.verifyEmail");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

// Better Auth's error code for a link that does not work, to the key under verifyEmail.errors.
const ERRORS = {
  TOKEN_EXPIRED: "tokenExpired",
  INVALID_TOKEN: "invalidToken",
  USER_NOT_FOUND: "userNotFound",
  INVALID_USER: "invalidUser",
} as const;

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

// The landing page of every link in the account emails. The links go through Better Auth, which
// verifies and then redirects here: with `done=1` when it worked, with `error=<code>` when not.
// Anyone can type that address, so a confirmation is only claimed for a member whose account says
// the address is confirmed; everyone else is told what to expect.
export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/[locale]/verify-email">) {
  const [t, params, viewer] = await Promise.all([
    getTranslations("auth.verifyEmail"),
    searchParams,
    getViewer(),
  ]);
  const error = first(params.error);
  const resent = first(params.resent);
  if (first(params.done) && !error) {
    const confirmed = viewer.user
      ? (await getCurrentAccount())?.emailVerified === true
      : false;
    return (
      <AuthShell heading={confirmed ? t("successHeading") : t("doneHeading")}>
        <div className="space-y-4 text-center">
          <p role="status" className="text-sm text-muted-foreground">
            {confirmed ? t("success") : t("done")}
          </p>
          <Link
            href={viewer.user ? "/" : "/login"}
            className={cn(buttonVariants(), "h-10 w-full md:h-8")}
          >
            {viewer.user ? t("continue") : t("login")}
          </Link>
        </div>
      </AuthShell>
    );
  }
  const message = error
    ? t(
        `errors.${ERRORS[error as keyof typeof ERRORS] ?? "generic"}` as "errors.generic",
      )
    : t("waiting");
  return (
    <AuthShell heading={error ? t("failureHeading") : t("waitingHeading")}>
      <div className="space-y-6">
        <p
          role={error ? "alert" : "status"}
          className="text-center text-sm text-muted-foreground"
        >
          {resent ? t("resent") : message}
        </p>
        <ResendForm from="verify" email={viewer.user?.email} />
      </div>
    </AuthShell>
  );
}
