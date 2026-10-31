"use server";

import { redirect } from "next/navigation";
import { decideDeviceRequest } from "@/lib/sermo/auth";

// The member's answer to a device login, from the page that read it for them (which claimed the
// code). The backend checks the session, the code, its expiry and that it is the member's. A
// refusal goes back to the page, which draws what the code is now (expired, answered, or a sign-in
// first) and says the request failed.
export async function decideDevice(formData: FormData) {
  const code = String(formData.get("user_code") ?? "").trim();
  if (!code) redirect("/device");
  const choice = formData.get("choice") === "approve" ? "approve" : "deny";
  const result = await decideDeviceRequest(code, choice);
  if (result.ok)
    redirect(`/device?result=${choice === "approve" ? "approved" : "denied"}`);
  redirect(`/device?user_code=${encodeURIComponent(code)}&failed=1`);
}
