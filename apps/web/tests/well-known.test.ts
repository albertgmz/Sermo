import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_ROUTES } from "@/lib/page-routes";
// Bun's runner does not look in folders whose name starts with a dot, so the routes' test is here.
import { GET as missing } from "../src/app/.well-known/[[...path]]/route";
import { GET as changePassword } from "../src/app/.well-known/change-password/route";

test("/.well-known/change-password sends the browser to the password form of the security page", () => {
  const response = changePassword();
  expect(response.status).toBe(302);
  const location = response.headers.get("location") ?? "";
  expect(location).toBe("/account/security#password");
  expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  const [path, section] = location.split("#");
  expect(PAGE_ROUTES).toContain(path as (typeof PAGE_ROUTES)[number]);
  const sections = readFileSync(
    join(
      import.meta.dir,
      "../src/app/[locale]/(main)/account/security/sections.tsx",
    ),
    "utf8",
  );
  expect(sections).toContain(`<section id="${section}"`);
});

test("/.well-known and any address under it the site does not publish are a plain-text 404, not the HTML page", async () => {
  const response = missing();
  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(await response.text()).toBe("Not found.\n");
});
