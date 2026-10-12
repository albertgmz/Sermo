import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DetailsForm } from "@/app/(main)/account/details/details-form";
import { getPermissions } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account details - forum/ui" };

export default async function DetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ saved }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const permissions = await getPermissions(user.id);
  const usernamePermission = permissions.find(
    (permission) => permission.key === "usernameChange",
  );

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">Account details</h1>
        <p className="text-xs text-muted-foreground">
          The name and title shown on your profile and posts.
        </p>
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
