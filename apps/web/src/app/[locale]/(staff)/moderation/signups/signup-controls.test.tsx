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

import type { RejectOptions } from "./reject-options";

const { DecideControls } = await import("./signup-controls");
const { SignupSelection, SignupTick } = await import("./signup-selection");
const { onPage } = await import("@/components/staff/row-selection");

const s = messages.moderation.signups;

const BOTH: RejectOptions = {
  erase: true,
  ban: { forever: true, maxDays: 3650 },
};

const controls = (options: RejectOptions) =>
  renderToStaticMarkup(
    withIntl(<DecideControls userIds={[7, 8]} options={options} />),
  );

const radiosOf = (html: string, name: string) =>
  (html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []).filter((radio) =>
    radio.includes(`name="${name}"`),
  );

test("approve and reject name the same accounts, and rejecting offers a ban first", () => {
  const html = controls(BOTH);
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
  // Banning is the default: it is checked and listed first, and no password is asked.
  const modes = radiosOf(html, "mode");
  expect(modes.map((radio) => radio.includes("checked"))).toEqual([
    true,
    false,
  ]);
  expect(modes[0]).toContain('value="ban"');
  expect(html).not.toContain('name="actorPassword"');
  // Each choice says what it keeps or loses.
  expect(html).toContain(s.reject.modeHelp.ban);
  expect(html).toContain(s.reject.modeHelp.delete);
});

test("a ban has a length: days, and for good only where the viewer may", () => {
  const any = controls(BOTH);
  expect(
    radiosOf(any, "duration").map(
      (radio) => /value="([a-z]+)"/.exec(radio)?.[1],
    ),
  ).toEqual(["days", "forever"]);
  expect(any).toContain('name="banDays"');
  expect(any).toContain(s.reject.banForever);
  expect(any).toContain('max="3650"');

  const bounded = controls({
    erase: false,
    ban: { forever: false, maxDays: 30 },
  });
  expect(bounded).not.toContain(s.reject.banForever);
  expect(radiosOf(bounded, "duration")).toHaveLength(1);
  expect(bounded).toContain('max="30"');
  expect(bounded).toContain("up to 30 days");
});

test("rejecting offers only what the viewer may do, and nothing when neither", () => {
  const eraseOnly = controls({ erase: true, ban: null });
  expect(eraseOnly).toContain(s.reject.mode.delete);
  expect(eraseOnly).not.toContain(s.reject.mode.ban);
  // Erasing is the only choice, so it is the checked one and asks for the password.
  expect(radiosOf(eraseOnly, "mode")).toHaveLength(1);
  expect(eraseOnly).toContain('name="actorPassword"');
  expect(eraseOnly).not.toContain('name="banDays"');

  const banOnly = controls({
    erase: false,
    ban: { forever: true, maxDays: 3650 },
  });
  expect(banOnly).toContain(s.reject.mode.ban);
  expect(banOnly).not.toContain(s.reject.mode.delete);

  const neither = controls({ erase: false, ban: null });
  expect(neither).toContain(s.approve);
  expect(neither).not.toContain(s.reject.summary);
});

test("the list bar waits for ticks: nothing to decide on until a row is selected", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <SignupSelection pageIds={[7, 8]} options={BOTH}>
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
      withIntl(
        <SignupSelection pageIds={[]} options={BOTH}>
          x
        </SignupSelection>,
      ),
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
