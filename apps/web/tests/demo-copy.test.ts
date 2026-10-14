import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_DIRS, MESSAGES } from "./locales";

// The site speaks with its own voice: the name and description come from the backend, so no
// message may carry the words of a demo.
test("no message carries demo copy", () => {
  for (const locale of LOCALE_DIRS) {
    const dir = join(MESSAGES, locale);
    for (const file of readdirSync(dir)) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, `${locale}/${file}`).not.toContain("interface kit");
      expect(text, `${locale}/${file}`).not.toContain("Elena Park");
    }
  }
});

test("the register page draws no testimonial", () => {
  const source = readFileSync(
    join(import.meta.dir, "..", "src/app/[locale]/(auth)/register/page.tsx"),
    "utf8",
  );
  expect(source).not.toContain("blockquote");
  expect(source).not.toContain("quote");
});
