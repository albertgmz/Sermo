import "server-only";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/lib/security-headers";

// The nonce of this response, for a script the page draws itself (Next puts it on its own). The
// proxy sets it on every page request; undefined only for a render it did not see.
export async function scriptNonce() {
  return (await headers()).get(NONCE_HEADER) ?? undefined;
}
