// The nonce the browser checks a script against: the document's, the one the page was loaded with.
// An answer to a later soft navigation was made with a nonce of its own, which the policy in force
// does not name, so a script first drawn then must take this one. It is read once, while the page
// first loads (`DocumentNonceKeeper` in the root layout imports this module before hydration): a
// later render of the root layout may write that answer's nonce onto the head scripts it drew, and the
// DOM then no longer tells the document's. The browser hides the attribute's value once the page has
// loaded; the property keeps it. Undefined on the server, where the response's own nonce is the
// document's.
let first: string | undefined;

export function documentNonce() {
  if (typeof document === "undefined") return undefined;
  first ??=
    document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ||
    undefined;
  return first;
}

// For tests: read the document again.
export function forgetDocumentNonce() {
  first = undefined;
}
