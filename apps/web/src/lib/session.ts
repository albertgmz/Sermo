import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { getClientInfo } from "@/lib/client";
import { endSession, getUserById, recordSignIn, type UserView } from "@/lib/db";

export const COOKIE = "demo_user";

export const getCurrentUser = cache(async (): Promise<UserView | null> => {
  const id = Number((await cookies()).get(COOKIE)?.value);
  return Number.isInteger(id) && id > 0 ? getUserById(id) : null;
});

export async function signIn(userId: number): Promise<void> {
  await recordSignIn(userId, await getClientInfo());
  (await cookies()).set(COOKIE, String(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const id = Number(store.get(COOKIE)?.value);
  if (Number.isInteger(id)) await endSession(id, await getClientInfo());
  store.delete(COOKIE);
}
