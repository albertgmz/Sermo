import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { resendOwnVerification } from "@/app/[locale]/(main)/account/security/actions";
import { EmailChangeForm } from "@/app/[locale]/(main)/account/security/email-forms";
import { rowClass } from "@/app/[locale]/(main)/account/security/form-rows";
import {
  Notice,
  noticeOf,
} from "@/app/[locale]/(main)/account/security/notice";
import { PasswordForm } from "@/app/[locale]/(main)/account/security/password-form";
import { PendingButton } from "@/components/forum/pending-button";
import { Badge } from "@/components/ui/badge";
import { getCurrentAccount, mailAvailable } from "@/lib/sermo/auth";

type Params = Promise<{ notice?: string | string[] }>;

export async function PasswordSection({
  searchParams,
}: {
  searchParams: Params;
}) {
  const [t, notice] = await Promise.all([
    getTranslations("account.security.password"),
    noticeOf(searchParams, ["password"]),
  ]);
  return (
    <section id="password" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <Notice notice={notice} />
      <PasswordForm />
    </section>
  );
}

export async function EmailSection({ searchParams }: { searchParams: Params }) {
  const [t, account, notice] = await Promise.all([
    getTranslations("account.security.email"),
    getCurrentAccount(),
    noticeOf(searchParams, [
      "emailChange",
      "verification",
      "resendFailed",
      "rateLimited",
    ]),
  ]);
  if (!account) redirect("/login");
  // Asked after the session, so it is answered at request time.
  const mail = await mailAvailable();

  return (
    <section id="email" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <Notice notice={notice} />
      <div className={rowClass}>
        <p className="self-start text-sm font-medium sm:pt-1">
          {t("addressLabel")}
        </p>
        <div className="min-w-0 space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="break-all">{account.email}</span>
            {mail && (
              <Badge variant={account.emailVerified ? "success" : "outline"}>
                {account.emailVerified ? t("verified") : t("unverified")}
              </Badge>
            )}
          </p>
          {!mail && (
            <p className="text-xs text-muted-foreground">{t("unavailable")}</p>
          )}
          {mail && !account.emailVerified && (
            <>
              <p className="text-xs text-muted-foreground">
                {t("unverifiedHint")}
              </p>
              <form action={resendOwnVerification}>
                <PendingButton variant="outline" className="min-h-10 px-4">
                  {t("resend")}
                </PendingButton>
              </form>
            </>
          )}
        </div>
      </div>
      {mail && (
        <div className="border-t">
          <EmailChangeForm />
        </div>
      )}
    </section>
  );
}
