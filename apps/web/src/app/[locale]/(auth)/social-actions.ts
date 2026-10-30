"use server";

import { SOCIAL_PROVIDERS } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { VIA_PARAM } from "@/app/[locale]/(auth)/social-refusal";
import { startSocialSignIn } from "@/lib/sermo/auth";
import { chooseUsernamePath, safeReturnPath } from "@/lib/sermo/return-path";

// A provider's button: the browser goes on to the provider's page. A refusal comes back to the page
// the button was on, with the provider and the code in the address (`social-refusal.ts`), and so
// does a sign-in the backend could not start. A new account goes to the username screen first.
export async function signInWith(formData: FormData): Promise<void> {
  const provider = SOCIAL_PROVIDERS.find(
    (name) => name === formData.get("provider"),
  );
  const page = formData.get("from") === "/register" ? "/register" : "/login";
  const next = safeReturnPath(formData.get("next"));
  if (!provider) redirect(page);
  const back = (code?: string) =>
    `${page}?${new URLSearchParams({
      ...(next === "/" ? {} : { next }),
      [VIA_PARAM]: provider,
      ...(code ? { error: code } : {}),
    })}`;
  const started = await startSocialSignIn(provider, {
    signedIn: next,
    refused: back(),
    newAccount: chooseUsernamePath(next),
  });
  redirect(started.url ?? back(started.code ?? "unknown"));
}
