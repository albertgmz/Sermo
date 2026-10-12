import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DetailsForm } from "@/app/(main)/account/account-details-form";
import { getPermissions } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export async function AccountDetails({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ saved }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const t = await getTranslations("account.accountDetails");
  const permissions = await getPermissions(user.id);
  const usernamePermission = permissions.find(
    (permission) => permission.key === "usernameChange",
  );

  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <DetailsForm
        key={`${user.username}:${user.customTitle}`}
        username={user.username}
        title={user.customTitle ?? ""}
        canChangeUsername={can(user, "usernameChange")}
        canChangeTitle={can(user, "customTitle")}
        usernameChanges={usernamePermission?.quantity ?? null}
        saved={saved === "details" || saved === "title" || saved === "username"}
      />
    </section>
  );
}
