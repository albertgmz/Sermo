import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// `src/i18n/request.ts` falls back to the visitor's own language when Next refuses root
// parameters, recognising the refusal by its wording. This holds the wording to the installed Next.
test("the installed Next still refuses root params in actions and route handlers in the words the fallback matches", () => {
  const source = readFileSync(
    createRequire(import.meta.url).resolve(
      "next/dist/server/request/root-params.js",
    ),
    "utf8",
  );
  expect(source).toContain("inside a Route Handler");
  expect(source).toContain("inside a Server Action");
});
