import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// The controls import the server action; its module reaches the backend, which no test here asks.
mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const { DecideControls } = await import("./signup-controls");
const { SignupSelection, SignupTick, onPage } = await import(
  "./signup-selection"
);

const s = messages.moderation.signups;

test("approve and reject name the same accounts, and rejecting offers deleting first", () => {
  const html = renderToStaticMarkup(
    withIntl(<DecideControls userIds={[7, 8]} />),
  );
  // Approve: a form of its own with the ids and the decision.
  expect(html).toContain('name="decision" value="approve"');
  expect(html).toContain('name="userIds" value="7,8"');
  expect(html).toContain(s.approve);
  // Reject: behind a confirmation step, with its reason and the choice of what it does.
  expect(html).toContain(s.reject.summary);
  expect(html).toContain('name="decision" value="reject"');
  expect(html).toContain(s.reject.reason);
  expect(html).toContain(s.reject.mode.delete);
  expect(html).toContain(s.reject.mode.ban);
  // Deleting is the default: it is checked, and it asks for the password.
  const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  expect(radios.map((radio) => radio.includes("checked"))).toEqual([
    true,
    false,
  ]);
  expect(radios[0]).toContain('value="delete"');
  expect(html).toContain('name="actorPassword"');
});

test("the list bar waits for ticks: nothing to decide on until a row is selected", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <SignupSelection pageIds={[7, 8]}>
        <SignupTick id={7} name="wren" />
      </SignupSelection>,
    ),
  );
  expect(html).toContain(s.select.replace("{name}", "wren"));
  expect(html).toContain("0 sign-ups selected");
  expect(html).toContain(s.selectAll);
  expect(html).not.toContain(s.approve);
  expect(html).not.toContain('name="userIds"');
});

test("an empty page has no bar, and a tick outside the list draws nothing", () => {
  expect(
    renderToStaticMarkup(
      withIntl(<SignupSelection pageIds={[]}>x</SignupSelection>),
    ),
  ).toBe("x");
  expect(
    renderToStaticMarkup(withIntl(<SignupTick id={7} name="wren" />)),
  ).toBe("");
});

test("the selection counts only ticked accounts that are still on the page", () => {
  const ticked = new Set([7, 8, 9]);
  // Approved or erased accounts leave the list; the count never exceeds what is shown.
  expect([...onPage(ticked, [8, 9, 10])]).toEqual([8, 9]);
  // Another page: nothing carries over.
  expect(onPage(ticked, [20, 21]).size).toBe(0);
  expect(onPage(new Set(), [1, 2]).size).toBe(0);
});
