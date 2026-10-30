import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { chooseUsernamePath } from "@/lib/sermo/return-path";

// A member whose account a sign-in provider made has no username of their own yet (`needsUsername`):
// any forum page they open sends them to choose one first, and back to that page afterwards (the
// proxy names it in `x-sermo-path`). `AcceptanceGate` asks this with the request's member before it
// draws the page. The username screen, sign-out, the API and the site's files are outside the
// forum's layout, so this never stands in their way.
export async function requireOwnUsername(
  member: { needsUsername?: boolean } | null,
): Promise<void> {
  if (member?.needsUsername)
    redirect(chooseUsernamePath((await headers()).get("x-sermo-path")));
}
