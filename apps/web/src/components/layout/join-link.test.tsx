import { afterEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JoinLink } from "@/components/layout/join-link";
import { hostJoinWindow, type JoinAsk } from "@/lib/join-window";

// An action only members can take, pressed by a guest: the sign-up window where the page holds it,
// the log-in page where it does not.

let release = () => {};
afterEach(() => release());

const link = () =>
  JoinLink({ reason: "react", next: "/threads/3?page=2", children: "Like" });

function press(modified = false) {
  let prevented = false;
  (link() as ReactElement<{ onClick: (event: unknown) => void }>).props.onClick(
    {
      button: 0,
      ctrlKey: modified,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {
        prevented = true;
      },
    },
  );
  return prevented;
}

test("is a link to the log-in page that comes back to the page", () => {
  const html = renderToStaticMarkup(link());
  expect(html).toContain('href="/login?next=%2Fthreads%2F3%3Fpage%3D2"');
  expect(html).toContain("data-join");
});

test("a press opens the sign-up window instead of the log-in page", () => {
  const asked: JoinAsk[] = [];
  release = hostJoinWindow({ open: (ask) => asked.push(ask), warm: () => {} });
  expect(press()).toBe(true);
  expect(asked).toEqual([{ reason: "react", next: "/threads/3?page=2" }]);
});

test("a press for a new tab still follows the link", () => {
  const asked: JoinAsk[] = [];
  release = hostJoinWindow({ open: (ask) => asked.push(ask), warm: () => {} });
  expect(press(true)).toBe(false);
  expect(asked).toEqual([]);
});

test("without the window on the page (registration closed, its code not in yet) the link is followed", () => {
  expect(press()).toBe(false);
  const asked: JoinAsk[] = [];
  const first = hostJoinWindow({
    open: (ask) => asked.push(ask),
    warm: () => {},
  });
  first();
  expect(press()).toBe(false);
  expect(asked).toEqual([]);
});
