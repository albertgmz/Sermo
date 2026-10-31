import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { widthScript } from "@/components/layout/narrow-width";
import { SIGNED_OUT_COOKIE, signedOutScript } from "./signed-out";

// A page as far as the script reads and writes it.
function page(cookie: string, protocol = "https:") {
  const written: string[] = [];
  const stores = {
    local: new Map([["sermo-theme", "dark"]]),
    session: new Map([["sermo-edit-draft:4", "text"]]),
  };
  const storage = (store: Map<string, string>) => ({
    clear: () => store.clear(),
  });
  const document = {
    get cookie() {
      return cookie;
    },
    set cookie(line: string) {
      written.push(line);
    },
  };
  new Function(
    "document",
    "location",
    "localStorage",
    "sessionStorage",
    signedOutScript,
  )(document, { protocol }, storage(stores.local), storage(stores.session));
  return { written, stores };
}

test("the first page after a sign-out clears the storage of the site and expires the mark", () => {
  const { written, stores } = page(
    `forum_locale=es; ${SIGNED_OUT_COOKIE}=1; forum_consent=x`,
  );
  expect(stores.local.size).toBe(0);
  expect(stores.session.size).toBe(0);
  expect(written).toEqual([
    `${SIGNED_OUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`,
  ]);
});

test("a site on plain http expires the mark without Secure", () => {
  expect(page(`${SIGNED_OUT_COOKIE}=1`, "http:").written).toEqual([
    `${SIGNED_OUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`,
  ]);
});

test("any other page leaves the storage alone", () => {
  for (const cookie of [
    "",
    "forum_locale=es",
    `x${SIGNED_OUT_COOKIE}=1`,
    `${SIGNED_OUT_COOKIE}=0`,
    `${SIGNED_OUT_COOKIE}=10`,
  ]) {
    const { written, stores } = page(cookie);
    expect(stores.local.size, cookie).toBe(1);
    expect(stores.session.size, cookie).toBe(1);
    expect(written, cookie).toEqual([]);
  }
});

test("a browser that refuses access to its storage still loses the mark", () => {
  const written: string[] = [];
  const refusing = {
    clear: () => {
      throw new Error("SecurityError");
    },
  };
  new Function(
    "document",
    "location",
    "localStorage",
    "sessionStorage",
    signedOutScript,
  )(
    {
      get cookie() {
        return `${SIGNED_OUT_COOKIE}=1`;
      },
      set cookie(line: string) {
        written.push(line);
      },
    },
    { protocol: "https:" },
    refusing,
    refusing,
  );
  expect(written).toHaveLength(1);
});

test("every page runs the clean-up first, before the scripts that read the storage", () => {
  const layout = readFileSync(
    `${import.meta.dir}/../app/[locale]/layout.tsx`,
    "utf8",
  );
  const first = layout.search(/\$\{signedOutScript\};\$\{widthScript\}/);
  expect(first).toBeGreaterThan(-1);
  expect(first).toBeLessThan(layout.indexOf("__html: themeScript"));
  // The two scripts in one element still parse as two statements.
  expect(() => new Function(`${signedOutScript};${widthScript}`)).not.toThrow();
});
