"use server";

import { authNotMe } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/[locale]/(auth)/actions";
import { isHydrated, refusedAddress } from "@/app/[locale]/(auth)/native-form";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The page only shows the button: the link of a mail may be opened by a scanner, so reading it
// changes nothing. Pressing the button signs the account out everywhere, and the member is
// taken to sign in again and change the password.
export async function confirmNotMe(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/not-me");
  try {
    await call(authNotMe, { token });
  } catch (error) {
    if (error instanceof SermoError && error.code === "validation") {
      redirect("/not-me?error=INVALID_TOKEN");
    }
    // A form sent without the page's script has no state to draw (see `native-form.ts`).
    if (!isHydrated(formData))
      redirect(refusedAddress("/not-me", "generic", { token }));
    return { error: await errorMessage(error) };
  }
  redirect(
    `/login?notMe=1&next=${encodeURIComponent("/account/security#password")}`,
  );
}
