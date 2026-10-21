import { afterAll, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));

// The stand-in records what the panel would open with; the page draws only the plain trigger.
let opened: { children: React.ReactNode; title: string } | undefined;
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: {
    popup: { children: React.ReactNode; title: string };
    trigger: (lazy: object) => ReactElement;
  }) => {
    opened = props.popup;
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { InboxPanel } = await import("./inbox-panel");
const { loadAlerts, loadConversations } = await import("./panel-actions");

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {node}
      </QueryClientProvider>,
    ),
  );

// The list element the panel holds (inside the boundary that waits for its code).
function list() {
  const parts = Array.isArray(opened?.children) ? opened.children : [];
  const found = parts
    .flatMap((part) =>
      isValidElement<{ children?: React.ReactNode }>(part)
        ? [part, part.props.children]
        : [],
    )
    .find(
      (part): part is ReactElement<{ kind: string; load: unknown }> =>
        isValidElement(part) && "load" in (part.props as object),
    );
  if (!found) throw new Error("the panel holds no list");
  return found.props;
}

test("each button is named with its unread count and shows it as a number", () => {
  const alerts = render(
    <InboxPanel kind="alerts" unread={3} footer={<p>footer</p>} />,
  );
  expect(alerts).toContain('aria-label="Alerts, 3 unread"');
  expect(alerts).toMatch(/data-slot="count-badge"[^>]*>3<\/span>/);
  expect(alerts).toContain("lucide-bell");

  const messages = render(
    <InboxPanel kind="conversations" unread={120} footer={<p>footer</p>} />,
  );
  expect(messages).toContain('aria-label="Direct messages, 120 unread"');
  expect(messages).toMatch(/data-slot="count-badge"[^>]*>99\+<\/span>/);
  expect(messages).toContain("lucide-mail");
});

test("with nothing unread a button carries its name alone and no number", () => {
  const html = render(
    <InboxPanel kind="alerts" unread={0} footer={<p>footer</p>} />,
  );
  expect(html).toContain('aria-label="Alerts"');
  expect(html).not.toContain("count-badge");
});

test("the alerts panel opens on the latest alerts with its footer", () => {
  render(<InboxPanel kind="alerts" unread={3} footer={<p>alerts footer</p>} />);
  expect(opened?.title).toBe("Alerts");
  expect(list()).toMatchObject({ kind: "alerts", count: 3, load: loadAlerts });
  const panel = render(opened?.children);
  expect(panel).toContain("Loading alerts…");
  expect(panel).toContain("alerts footer");
});

test("the messages panel opens on the latest conversations with its footer", () => {
  render(
    <InboxPanel
      kind="conversations"
      unread={0}
      footer={<p>messages footer</p>}
    />,
  );
  expect(opened?.title).toBe("Direct messages");
  expect(list()).toMatchObject({
    kind: "conversations",
    count: 0,
    load: loadConversations,
  });
  const panel = render(opened?.children);
  expect(panel).toContain("Loading direct messages…");
  expect(panel).toContain("messages footer");
});

test("the list's code is not part of the page's first load: the panel fetches it when it opens", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("./inbox-panel.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain('import("@/components/layout/user-menu-list")');
  expect(source).not.toMatch(/^import [^;]*user-menu-list";/m);
  expect(source).not.toMatch(/react-query/);
});
