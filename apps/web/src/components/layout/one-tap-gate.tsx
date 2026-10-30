import { getLocale } from "next-intl/server";
import { forwardFromRequest } from "@/lib/sermo/client";
import { getSocialSignIn } from "@/lib/sermo/social-sign-in";
import { sermoCookies } from "@/lib/sermo/transport";
import { OneTap } from "./one-tap";

// Google One Tap for a guest while Google sign-in is on: the forum's pages and the sign-in and
// sign-up pages draw this, the staff panel never does. A visitor with a session cookie gets none
// and the page does not wait for the guest's auth.me (a dead cookie loses the prompt, never a
// member who would get it). One Tap is part of signing in, a strictly necessary function: it is
// not held back by the cookie choice, as the analytics tag is.
export async function OneTapGate({
  context = "signin",
  next,
}: {
  context?: "signin" | "signup";
  next?: string;
}) {
  if (sermoCookies((await forwardFromRequest()).cookie)) return null;
  const [{ googleClientId }, locale] = await Promise.all([
    getSocialSignIn(),
    getLocale(),
  ]);
  if (!googleClientId) return null;
  return (
    <OneTap
      clientId={googleClientId}
      locale={locale}
      context={context}
      {...(next ? { next } : {})}
    />
  );
}
