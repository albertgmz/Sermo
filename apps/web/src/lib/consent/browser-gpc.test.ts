import { expect, test } from "bun:test";
import {
  browserSendsGpc,
  eraseOptionalCookies,
  forgetChoiceOverriddenByGpc,
} from "./browser-gpc";

const choice = (data: unknown, ...categories: string[]) =>
  encodeURIComponent(
    JSON.stringify({
      categories: ["necessary", ...categories],
      revision: 2,
      data,
    }),
  );

// A document whose cookie string is `held`, recording what is written to it.
function page(held: string) {
  const written: string[] = [];
  return {
    written,
    doc: {
      get cookie() {
        return held;
      },
      set cookie(value: string) {
        written.push(value);
      },
    },
  };
}

test("the browser's signal is navigator.globalPrivacyControl, and only when it is true", () => {
  expect(browserSendsGpc({ globalPrivacyControl: true } as never)).toBe(true);
  expect(browserSendsGpc({ globalPrivacyControl: false } as never)).toBe(false);
  expect(browserSendsGpc({} as never)).toBe(false);
});

test("an acceptance made before the signal is taken off, for the host and host-only, so the banner asks again", () => {
  const { doc, written } = page(
    `forum_lite=all; forum_consent=${choice(null, "analytics")}`,
  );
  expect(forgetChoiceOverriddenByGpc(doc, "forum.example.com", 2)).toBe(true);
  expect(written).toEqual([
    "forum_consent=; Max-Age=0; Path=/; SameSite=Lax",
    "forum_consent=; Max-Age=0; Path=/; SameSite=Lax; Domain=forum.example.com",
  ]);
  // A host without a dot has only the host-only cookie.
  const local = page(
    `forum_consent=${choice({ source: "account" }, "embeds")}`,
  );
  expect(forgetChoiceOverriddenByGpc(local.doc, "localhost", 2)).toBe(true);
  expect(local.written).toHaveLength(1);
});

test("a choice made after the signal, a refusal, another version or no cookie stays", () => {
  for (const held of [
    `forum_consent=${choice({ gpc: true }, "analytics", "embeds")}`,
    `forum_consent=${choice({ source: "account", gpc: true }, "embeds")}`,
    `forum_consent=${choice(null)}`,
    `forum_consent=${encodeURIComponent(JSON.stringify({ categories: ["necessary", "embeds"], revision: 1 }))}`,
    "forum_lite=all",
    "",
  ]) {
    const { doc, written } = page(held);
    expect(forgetChoiceOverriddenByGpc(doc, "forum.example.com", 2), held).toBe(
      false,
    );
    expect(written).toEqual([]);
  }
});

test("once a choice is taken off, the cookies of every optional category are erased where the library looks for them", () => {
  const erased: [string, string, string | undefined][] = [];
  eraseOptionalCookies(
    (name, path, domain) => erased.push([String(name), path, domain]),
    "forum.example.com",
  );
  const names = erased.map(([name]) => name);
  // Statistics (exact names and prefixes) and the referral cookie, on this host and its parents.
  expect(names).toContain("_ga");
  expect(names).toContain(String(/^_ga_/));
  expect(names).toContain("forum_ref");
  expect(erased).toContainEqual(["_ga", "/", ".example.com"]);
  expect(erased).toContainEqual(["_ga", "/", undefined]);
  expect(erased.every(([, path]) => path === "/")).toBe(true);
  // Nothing strictly necessary.
  for (const name of ["forum_consent", "forum_locale", "forum_lite"])
    expect(names).not.toContain(name);
});
