import { getTranslations } from "next-intl/server";
import { deleteAccount } from "@/app/[locale]/(main)/account/security/actions";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getViewer } from "@/lib/sermo/session";

// The member's own way out. Drawn only for a member whose groups allow it; the backend decides
// all the same. It states what goes and what stays, then asks for the username typed out and the
// password, in the confirmation step the administration panel uses for its irreversible actions.
export async function DeleteAccountSection() {
  const [{ user, resolvedPermissions }, t] = await Promise.all([
    getViewer(),
    getTranslations("account.security.delete"),
  ]);
  if (!user || resolvedPermissions["profile.deleteAccount"] !== true) {
    return null;
  }
  return (
    <ConfirmStep
      action={deleteAccount}
      heading={t("heading")}
      summary={t("summary")}
      warning={t("warning")}
      submit={t("submit")}
      pendingLabel={t("pending")}
      password
    >
      <div className="space-y-3 px-4 text-sm text-pretty">
        <p>{t("removes")}</p>
        <p>{t("keeps")}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="delete-account-username" className="text-xs">
            {t("confirmLabel", { username: user.username })}
          </Label>
          <Input
            id="delete-account-username"
            name="confirmUsername"
            required
            autoComplete="off"
            autoCapitalize="none"
          />
        </div>
      </div>
    </ConfirmStep>
  );
}
