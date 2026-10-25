import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { recorded } from "@/lib/test-calls";
import { withIntl } from "@/lib/test-intl";

// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
const navigation = { ...(await import("next/navigation")) };
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/12-night-swim",
  useRouter: () => ({ back: () => {}, replace: () => {} }),
}));
afterAll(() => {
  mock.module("next-intl", () => intl);
  mock.module("next/navigation", () => navigation);
});
const { Dialog } = await import("@/components/ui/dialog");
const { AdultGate, AdultPage, AdultWarningBody, leaveGate, onGateChange } =
  await import("./adult-gate");

const g = messages.forum.adultGate;

// What the window holds. The box that keeps it over the page is drawn in a portal, which markup
// rendered on the server does not hold.
const warning = (reason: "acceptance" | "birthDate" | "minor") =>
  renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <AdultWarningBody reason={reason} onConfirmed={() => {}} />
      </Dialog>,
    ),
  );

test("a guest gets the +18 page with the ways in, back to the same page after logging in", () => {
  const html = renderToStaticMarkup(withIntl(<AdultPage guest />));
  expect(html).toContain(g.title);
  expect(html).toContain(g.pageGuest);
  expect(html).toContain(
    `href="/login?next=${encodeURIComponent("/threads/12-night-swim")}"`,
  );
  expect(html).toContain('href="/register"');
  expect(html).not.toContain("<form");
});

test("a guest's page has no warning window; a member's page has neither the ways in nor the content", () => {
  const guest = renderToStaticMarkup(
    withIntl(<AdultGate reason="guest" retry={() => {}} />),
  );
  expect(guest).toContain(g.pageGuest);
  const member = renderToStaticMarkup(
    withIntl(<AdultGate reason="acceptance" retry={() => {}} />),
  );
  expect(member).toContain(g.pageMember);
  expect(member).not.toContain("/login");
  expect(member).not.toContain("/register");
});

test("an adult with a stored date is asked to confirm, and may go back instead", () => {
  const html = warning("acceptance");
  expect(html).toContain(g.title);
  expect(html).toContain(g.warning);
  expect(html).toContain(g.confirmQuestion);
  expect(html).toMatch(
    new RegExp(`<button[^>]*type="submit"[^>]*>${g.confirm}<`),
  );
  expect(html).toContain(`>${g.back}<`);
  expect(html).not.toContain('name="birthDate"');
});

test("a member with no date of birth is asked for the full date, required, before confirming", () => {
  const html = warning("birthDate");
  expect(html).toContain(g.birthDateAsk);
  expect(html).toContain(g.birthDateLabel);
  const field = html.match(/<input[^>]*name="birthDate"[^>]*>/)?.[0] ?? "";
  expect(field).toContain('type="date"');
  expect(field).toContain('required=""');
  expect(field).toContain('min="1900-01-01"');
  expect(field).toMatch(/max="\d{4}-\d{2}-\d{2}"/);
  // The field's label names it.
  const id = field.match(/id="([^"]+)"/)?.[1];
  expect(html).toContain(`for="${id}"`);
  expect(html).toContain(`>${g.confirmWithDate}<`);
});

test("a minor is told politely and can only go back", () => {
  const html = warning("minor");
  expect(html).toContain(g.minor);
  expect(html).toContain(`>${g.back}<`);
  expect(html).not.toContain('type="submit"');
  expect(html).not.toContain("<form");
});

test("Escape or Back leaves the page: back when the tab has a page to go back to, else home", () => {
  const router = {
    back: recorded(() => {}),
    replace: recorded((_href: string) => {}),
  };
  leaveGate(router, 3);
  expect(router.back.calls).toHaveLength(1);
  expect(router.replace.calls).toHaveLength(0);
  leaveGate(router, 1);
  expect(router.replace.calls).toEqual([["/"]]);

  // The window closing (Escape, its Back button) is leaving; it never just closes.
  const leave = recorded(() => {});
  onGateChange(leave)(true);
  expect(leave.calls).toHaveLength(0);
  onGateChange(leave)(false);
  expect(leave.calls).toHaveLength(1);
});
