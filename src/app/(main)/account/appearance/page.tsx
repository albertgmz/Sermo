import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppearancePanel } from "@/app/(main)/account/appearance";
import { getShopItems, getUnlocks } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Appearance - forum/ui" };

export default async function AppearancePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [{ saved }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const [unlocks, shopItems] = await Promise.all([
    getUnlocks(user.id),
    getShopItems(),
  ]);
  const frameNames = Object.fromEntries(
    shopItems.flatMap(({ name, effect }) =>
      effect.type === "frame" ? [[effect.frame, name]] : [],
    ),
  );

  return (
    <AppearancePanel
      user={user}
      unlocks={unlocks}
      frameNames={frameNames}
      saved={typeof saved === "string" ? saved : undefined}
    />
  );
}
