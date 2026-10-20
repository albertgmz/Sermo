import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";
import { TRANSACTION } from "../../credits/test-fixtures";
import { htmlOf, mockIntl } from "../../credits/test-render";
import { fakeBackend } from "../../groups/test-backend";

const restore = await mockIntl();
// The table formats its times with the server formatter, which the shared stand-in lacks.
const stand = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...stand,
  getFormatter: async () => ({
    number: (value: number) => String(value),
    dateTime: (date: Date, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
        date,
      ),
  }),
}));
const members = { ...(await import("@/lib/sermo/members")) };
mock.module("@/lib/sermo/members", () => ({
  membersFor: async () => (ref: { username: string }) => ({
    username: ref.username,
    avatar: null,
    frame: null,
    nameColor: null,
  }),
}));
const { CreditLedger } = await import("./credit-ledger");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  restore();
  mock.module("@/lib/sermo/members", () => members);
});

test("a ledger line shows its amount, and the balance it left, grouped", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "credits.ledger": () =>
      Response.json({
        items: [{ ...TRANSACTION, amount: 12345, balanceAfter: 123456 }],
        nextCursor: null,
        balance: 123456,
      }),
  });
  const html = await htmlOf(
    await CreditLedger({ searchParams: Promise.resolve({}) }),
  );
  expect(html).toContain("+12,345");
  expect(html).toContain("123,456");
  expect(html).not.toContain("123456");
});
