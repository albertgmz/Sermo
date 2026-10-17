// The nonce the browser checks a script against: the document's, the one the page was loaded with.
// An answer to a later soft navigation was made with a nonce of its own, which the policy in force
// does not name, so a script first drawn then must take this one. The browser hides the attribute's
// value once the page has loaded; the property keeps it. Undefined on the server, where the
// response's own nonce is the document's.
export function documentNonce() {
  if (typeof document === "undefined") return undefined;
  return (
    document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ||
    undefined
  );
}
