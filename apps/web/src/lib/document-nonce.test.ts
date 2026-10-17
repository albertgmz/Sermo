import { afterEach, expect, test } from "bun:test";
import { documentNonce, forgetDocumentNonce } from "./document-nonce";

const real = globalThis.document;
afterEach(() => {
  globalThis.document = real;
  forgetDocumentNonce();
});

// A document whose first scripted element carries `nonce`, which a test may change.
function page(nonce: string) {
  const script = { nonce };
  globalThis.document = {
    querySelector: (selector: string) =>
      selector === "script[nonce]" ? script : null,
  } as unknown as Document;
  return script;
}

test("on the server there is no document nonce", () => {
  globalThis.document = undefined as unknown as Document;
  expect(documentNonce()).toBeUndefined();
});

test("the nonce the page was loaded with stays, whatever a later render writes on the head scripts", () => {
  const head = page("loaded");
  expect(documentNonce()).toBe("loaded");
  // A refresh or a server action re-renders the root layout with its answer's nonce.
  head.nonce = "refreshed";
  expect(documentNonce()).toBe("loaded");
});
