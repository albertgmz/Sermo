"use client";

import { documentNonce } from "@/lib/document-nonce";

// Takes the document's nonce while the page first loads: this module is part of the root layout,
// so the browser evaluates it before hydration, before any later render can rewrite the head
// scripts' nonce (see lib/document-nonce.ts). Draws nothing.
documentNonce();

export function DocumentNonceKeeper() {
  return null;
}
