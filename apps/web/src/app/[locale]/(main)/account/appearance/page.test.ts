import { expect, test } from "bun:test";
import AppearancePage from "./page";

test("the old appearance address redirects to the appearance group of the account screen", () => {
  let digest = "";
  try {
    AppearancePage();
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  const [code, type, location, status] = digest.split(";");
  expect(code).toBe("NEXT_REDIRECT");
  // A page the visitor was sent from is replaced in the history, not kept.
  expect(type).toBe("replace");
  expect(location).toBe("/account#appearance");
  // A server redirect, not the permanent 308 of the proxy.
  expect(status).toBe("307");
});
