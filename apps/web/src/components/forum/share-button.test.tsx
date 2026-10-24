import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// Share copies the link at once and says so in the floating notice; on a touch screen the device's
// share sheet takes it instead, where there is one.

// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => intl);
});
const { ShareButton } = await import("./share-button");
const { shareLink } = await import("./share-link");
const { announce, LINK_COPIED, saidNotice } = await import("./notice-store");

const URL_ = "https://forum.test/threads/3#post-1";
const settle = () => new Promise((done) => setTimeout(done, 0));

// A device: what it was asked to share and to copy.
function device({
  touch,
  share,
  copy = async () => {},
}: {
  touch: boolean;
  share?: (data: { url: string }) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}) {
  const shared: string[] = [];
  const copied: string[] = [];
  return {
    shared,
    copied,
    touch,
    share:
      share &&
      ((data: { url: string }) => {
        shared.push(data.url);
        return share(data);
      }),
    clipboard: {
      writeText: (text: string) => {
        copied.push(text);
        return copy(text);
      },
    },
  };
}

// What the member was told: the floating notice said, and the links handed over to copy by hand.
function outcome() {
  announce(null);
  const failed: string[] = [];
  return {
    said: () => ({
      copied: saidNotice()?.notice === LINK_COPIED,
      failed,
    }),
    done: (url: string) => {
      failed.push(url);
    },
  };
}

test("on a computer one press copies the link and says so, even where a share sheet exists", async () => {
  const pc = device({ touch: false, share: async () => {} });
  const { said, done } = outcome();
  shareLink(URL_, pc, done);
  await settle();
  expect(pc.copied).toEqual([URL_]);
  expect(pc.shared).toEqual([]);
  expect(said()).toEqual({ copied: true, failed: [] });
});

test("on a phone the share sheet takes the link and nothing is copied", async () => {
  const phone = device({ touch: true, share: async () => {} });
  const { said, done } = outcome();
  shareLink(URL_, phone, done);
  await settle();
  expect(phone.shared).toEqual([URL_]);
  expect(phone.copied).toEqual([]);
  expect(said()).toEqual({ copied: false, failed: [] });
});

test("a phone without a share sheet copies the link", async () => {
  const phone = device({ touch: true });
  const { said, done } = outcome();
  shareLink(URL_, phone, done);
  await settle();
  expect(phone.copied).toEqual([URL_]);
  expect(said().copied).toBe(true);
});

test("closing the share sheet is quiet; a sheet that fails copies the link instead", async () => {
  const closed = device({
    touch: true,
    share: () => Promise.reject(new DOMException("closed", "AbortError")),
  });
  const first = outcome();
  shareLink(URL_, closed, first.done);
  await settle();
  expect(closed.copied).toEqual([]);
  expect(first.said()).toEqual({ copied: false, failed: [] });

  const refused = device({
    touch: true,
    share: () => Promise.reject(new Error("refused")),
  });
  const second = outcome();
  shareLink(URL_, refused, second.done);
  await settle();
  expect(refused.copied).toEqual([URL_]);
  expect(second.said().copied).toBe(true);
});

test("where the clipboard refuses, the link is handed over to copy by hand", async () => {
  const pc = device({
    touch: false,
    copy: () => Promise.reject(new Error("denied")),
  });
  const { said, done } = outcome();
  shareLink(URL_, pc, done);
  await settle();
  expect(said()).toEqual({ copied: false, failed: [URL_] });
});

test("Share is a link to the item named Share, which opens no menu", () => {
  const html = renderToStaticMarkup(
    withIntl(<ShareButton href="/threads/3#post-1" label="Share" />),
  );
  expect(html).toMatch(/^<a href="\/threads\/3#post-1" aria-label="Share"/);
  expect(html).not.toContain("aria-haspopup");
  expect(html).not.toContain("Copy link");
  expect(html).toContain('<span class="hidden sm:inline">Share</span>');
});

afterEach(() => announce(null));
