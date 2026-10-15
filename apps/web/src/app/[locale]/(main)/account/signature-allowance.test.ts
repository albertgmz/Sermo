import { expect, test } from "bun:test";
import { createTranslator } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import { signatureAllowance } from "./signature-allowance";

const say = async (
  locale: "en" | "es",
  limits: Partial<Parameters<typeof signatureAllowance>[2]>,
) =>
  signatureAllowance(
    createTranslator({
      locale,
      messages: await messagesFor(locale),
      namespace: "account.title",
    } as never) as never,
    locale,
    {
      signatureMaxLinks: 0,
      signatureMaxImages: 0,
      signatureMaxSmilies: 0,
      signatureMaxTextSize: 0,
      signatureFormats: [],
      ...limits,
    },
  );

test("a site that allows no formatting says plain text, and no limit is read out", async () => {
  expect(await say("en", { signatureMaxLinks: 3 })).toBe("Plain text only.");
});

test("the allowed kinds are listed, with the limits that apply to them", async () => {
  expect(
    await say("en", {
      signatureFormats: ["bold", "link", "image"],
      signatureMaxLinks: 3,
      signatureMaxImages: 1,
      signatureMaxSmilies: 5,
    }),
  ).toBe(
    "Allowed formatting: bold, links, and pictures. Limits: up to 3 links, up to 1 picture, and up to 5 emoji.",
  );
});

test("0 and -1 are no limit, and a limit on a kind that is not allowed is left out", async () => {
  expect(
    await say("en", {
      signatureFormats: ["bold"],
      signatureMaxLinks: 3,
      signatureMaxImages: 2,
      signatureMaxSmilies: -1,
      signatureMaxTextSize: 4,
    }),
  ).toBe("Allowed formatting: bold.");
  expect(
    await say("en", { signatureFormats: ["link"], signatureMaxLinks: -1 }),
  ).toBe("Allowed formatting: links.");
});

test("the text size is said when sizes or headings are allowed", async () => {
  expect(
    await say("en", { signatureFormats: ["heading"], signatureMaxTextSize: 4 }),
  ).toContain("text up to size 4");
  expect(
    await say("en", { signatureFormats: ["size"], signatureMaxTextSize: 0 }),
  ).toBe("Allowed formatting: text sizes.");
});

test("it speaks Spanish with the visitor's list style", async () => {
  expect(
    await say("es", {
      signatureFormats: ["bold", "link"],
      signatureMaxLinks: 1,
    }),
  ).toBe("Formato permitido: negrita y enlaces. Límites: hasta 1 enlace.");
});
