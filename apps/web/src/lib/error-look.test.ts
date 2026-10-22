import { expect, test } from "bun:test";
import { errorLook } from "./error-look";

test("the language cookie wins over the browser's language", () => {
  expect(errorLook("es", "en-US", null, false).language).toBe("es");
  expect(errorLook("en", "es-CU", null, false).language).toBe("en");
});

test("without a cookie the browser's language decides, and English is the fallback", () => {
  expect(errorLook(undefined, "es-CU", null, false).language).toBe("es");
  expect(errorLook(undefined, "fr", null, false).language).toBe("en");
  expect(errorLook(undefined, undefined, null, false).language).toBe("en");
});

test("the page is dark for a dark choice, or a system choice on a dark device, never by default", () => {
  expect(errorLook(undefined, undefined, "dark", false).dark).toBe(true);
  expect(errorLook(undefined, undefined, "system", true).dark).toBe(true);
  expect(errorLook(undefined, undefined, "system", false).dark).toBe(false);
  expect(errorLook(undefined, undefined, "light", true).dark).toBe(false);
  expect(errorLook(undefined, undefined, null, true).dark).toBe(false);
});
