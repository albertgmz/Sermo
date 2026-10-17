import { afterEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { AnalyticsScript } from "./analytics-script";

const real = globalThis.document;
afterEach(() => {
  globalThis.document = real;
});

const nonceOf = (element: unknown) =>
  (element as ReactElement<{ nonce?: string }>).props.nonce;

test("on the server the script takes the nonce of the response it is drawn in", () => {
  globalThis.document = undefined as unknown as Document;
  expect(nonceOf(AnalyticsScript({ id: "a", nonce: "response" }))).toBe(
    "response",
  );
});

test("after a soft navigation the script takes the document's nonce, not the one that answer was made with", () => {
  globalThis.document = {
    querySelector: (selector: string) =>
      selector === "script[nonce]" ? { nonce: "document" } : null,
  } as unknown as Document;
  expect(
    nonceOf(AnalyticsScript({ id: "a", nonce: "navigation", children: "x" })),
  ).toBe("document");
});
