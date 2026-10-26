"use server";

import { consentAskAgain } from "@sermo/core/contracts";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { formFailure } from "../../groups/form-errors";
import { type Spec, saveSettings, scalars } from "../save";

const COOKIES: Spec = {
  cookieBannerOutsideEu: "bool",
};

export async function saveCookies(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  return saveSettings(await scalars(COOKIES, formData), {
    back: "/admin/settings/cookies",
    known: (name) => name in COOKIES,
    // The banner and the tag read these through the cached site.
    site: true,
  });
}

// Raises the cookie policy version by one: everyone is asked for their choice again.
export async function askEveryoneAgain(): Promise<StaffFormState> {
  try {
    await call(consentAskAgain, {});
  } catch (error) {
    return formFailure(error, []);
  }
  updateTag("site");
  redirect("/admin/settings/cookies?notice=asked");
}
