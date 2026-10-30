import { expect, test } from "bun:test";
import { errorLook } from "./error-look";

test("the language cookie chooses the language, and Spanish is the fallback", () => {
  expect(errorLook("en", null, false).language).toBe("en");
  expect(errorLook("es", null, false).language).toBe("es");
  expect(errorLook("EN", null, false).language).toBe("en");
  expect(errorLook(undefined, null, false).language).toBe("es");
  expect(errorLook("fr", null, false).language).toBe("es");
});

test("the page is dark for a dark choice, or a system choice on a dark device, never by default", () => {
  expect(errorLook(undefined, "dark", false).dark).toBe(true);
  expect(errorLook(undefined, "system", true).dark).toBe(true);
  expect(errorLook(undefined, "system", false).dark).toBe(false);
  expect(errorLook(undefined, "light", true).dark).toBe(false);
  expect(errorLook(undefined, null, true).dark).toBe(false);
});
