import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PermissionsPanel } from "@/app/(main)/account/permissions";
import { getPermissions, getShopItems } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Permissions - forum/ui" };

export default async function PermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ saved }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const [permissions, shopItems] = await Promise.all([
    getPermissions(user.id),
    getShopItems(),
  ]);
  const prices = Object.fromEntries(
    shopItems.flatMap(({ price, effect }) =>
      effect.type === "permission" ? [[effect.permission, price]] : [],
    ),
  );

  return (
    <PermissionsPanel
      user={user}
      permissions={permissions}
      prices={prices}
      saved={typeof saved === "string" ? saved : undefined}
    />
  );
}
