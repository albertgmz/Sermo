import { expect, test } from "bun:test";
import { read, walk } from "./lite-scan";

// Cloudflare's script is third-party, so it may load only where a visitor meets a guarded form:
// one file knows its address, and only the guest forms use that file.
const sources = walk("src").filter(
  (path) => /\.tsx?$/.test(path) && !/\.test\./.test(path),
);
const FIELD = "src/app/[locale]/(auth)/turnstile-field.tsx";

test("the Cloudflare address is in one file", () => {
  const holders = sources.filter((path) =>
    read(path).includes("challenges.cloudflare.com"),
  );
  expect(holders).toEqual([FIELD]);
});

test("only the guest forms draw the widget, and the layouts never do", () => {
  const users = sources.filter(
    (path) => path !== FIELD && read(path).includes("turnstile-field"),
  );
  expect(users.sort()).toEqual([
    "src/app/[locale]/(auth)/forgot-password/forgot-form.tsx",
    "src/app/[locale]/(auth)/login/login-form.tsx",
    "src/app/[locale]/(auth)/register/register-form.tsx",
    "src/app/[locale]/(auth)/resend-form.tsx",
  ]);
  for (const user of users) expect(read(user)).toContain("turnstileKey &&");
});

test("the widget is not stored by consent code and needs no consent", () => {
  const inventory = read("src/lib/consent/inventory.ts");
  expect(inventory).toMatch(/id: "turnstile",\s*category: "necessary"/);
});

test("the secret never reaches a client component or a shared fixture", () => {
  const holders = sources.filter((path) =>
    /turnstileSecret(?!Set)/.test(read(path)),
  );
  // The admin form that writes it and its action: server components and a server action. It is
  // write-only: nothing reads a secret back.
  expect(holders.sort()).toEqual([
    "src/app/[locale]/(staff)/admin/settings/actions.ts",
    "src/app/[locale]/(staff)/admin/settings/antispam/antispam-form.tsx",
    "src/app/[locale]/(staff)/admin/settings/fields.tsx",
  ]);
  for (const path of holders) expect(read(path)).not.toMatch(/^"use client"/);
});
