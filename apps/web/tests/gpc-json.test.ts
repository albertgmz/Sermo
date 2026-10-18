import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
// Bun's runner does not look in folders whose name starts with a dot, so the route's test is here.
import { GET } from "../src/app/.well-known/gpc.json/route";

test("the GPC support resource is a JSON object with a boolean gpc and an RFC 3339 date", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(
    /^application\/json(;|$)/,
  );
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["gpc", "lastUpdate"]);
  expect(body.gpc).toBe(true);
  expect(body.lastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Number.isNaN(Date.parse(body.lastUpdate))).toBe(false);
});

// The proxy rewrites every path it runs for into the language segment, where no such file is: the
// resource is served only while the proxy's matcher leaves its path out, as it does
// opensearch.xml. The matcher is read from the source as it is (the proxy is not loaded) and
// matched the way Next matches it (see tests/backend-paths.test.ts).
const literal = /matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/.exec(
  readFileSync(join(import.meta.dir, "../src/proxy.ts"), "utf8"),
)?.[1];
const matcher = new RegExp(
  tryToParsePath(literal ? JSON.parse(literal) : "").regexStr ?? "(?!)",
);

test("the matcher is read as the proxy has it", () => {
  expect(matcher.test("/threads/1")).toBe(true);
  expect(matcher.test("/opensearch.xml")).toBe(false);
});

// The sign-out route (`app/sign-out/route.ts`) is a route outside the language segment too: the
// proxy would rewrite its POST to `/<locale>/sign-out`, where no route is.
// To be turned into a plain `test` once the matcher leaves out `\.well-known/gpc\.json$` and
// `sign-out$` (the proxy is not this change's to edit).
test.todo("the proxy does not run for /.well-known/gpc.json nor for /sign-out", () => {
  expect(matcher.test("/.well-known/gpc.json")).toBe(false);
  expect(matcher.test("/sign-out")).toBe(false);
  expect(matcher.test("/sign-out/x")).toBe(true);
});
