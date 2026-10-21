import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useRouter: () => ({ push() {}, refresh() {} }),
}));
const intl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, io: async () => {} }));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { AccountMenu } = await import("./account-menu");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("next/cache", () => nextCache);
});
// Another test file leaves a stand-in for the viewer in place: the menu asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const queue = { count: 0, more: false, cap: 99 };
const answers = (signedIn: boolean) => ({
  "auth.me": () => Response.json(viewerBody(signedIn)),
  "auth.counters": () =>
    Response.json({
      notifications: 5,
      conversations: 2,
      openReports: queue,
      pendingApprovals: queue,
      pendingSignups: queue,
    }),
  "users.cards": () => Response.json({ items: [] }),
  "navigation.get": () =>
    Response.json({ header: [], mobile: [], account: [], footer: [] }),
});

async function markup(node: React.ReactNode) {
  const stream = await renderToReadableStream(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {node}
      </QueryClientProvider>,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a member gets the Messages and Alerts buttons, with their counts, before the avatar", async () => {
  backend = fakeBackend(answers(true));
  const html = await markup(await AccountMenu({ inboxClassName: "hidden" }));
  const messages = html.indexOf('aria-label="Direct messages, 2 unread"');
  const alerts = html.indexOf('aria-label="Alerts, 5 unread"');
  const avatar = html.indexOf('aria-label="Account menu"');
  expect(messages).toBeGreaterThan(-1);
  expect(alerts).toBeGreaterThan(messages);
  expect(avatar).toBeGreaterThan(alerts);
});

test("a guest gets no Messages or Alerts buttons, and no account menu", async () => {
  backend = fakeBackend(answers(false));
  expect(await AccountMenu({})).toBeNull();
});
