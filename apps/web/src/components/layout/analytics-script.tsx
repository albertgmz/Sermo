"use client";

import Script, { type ScriptProps } from "next/script";
import { documentNonce } from "@/lib/document-nonce";

// One of the analytics tag's scripts. The layouts that draw the tag may mount for the first time on a
// soft navigation (from the sign-in page or the panel to the forum), and the nonce that answer was
// made with is not the document's: in the browser the script takes the document's.
export function AnalyticsScript(props: ScriptProps) {
  return <Script {...props} nonce={documentNonce() ?? props.nonce} />;
}
