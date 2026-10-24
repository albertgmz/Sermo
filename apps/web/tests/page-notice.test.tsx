import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NoticeBox } from "@/components/forum/notice-card";
import {
  announce,
  closeOnEscape,
  holdNotice,
  noticeText,
  saidNotice,
} from "@/components/forum/notice-store";
import { NoticeStatus, PageNotice } from "@/components/forum/page-notice";

// The notice that floats over the page after a form answered in place: how long it stays, what
// keeps it, how it goes, and that a screen reader hears it.

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  announce(null);
  jest.useRealTimers();
});

const SHOWN_MS = 6000;
const texts = { bought: "Bought." };

type Props = Record<string, unknown> & { children?: ReactNode };

// Every element of a rendered tree that has the prop.
function withProp(node: ReactNode, prop: string): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((n) => withProp(n, prop));
  if (!isValidElement<Props>(node)) return [];
  return [
    ...(prop in node.props ? [node] : []),
    ...withProp(node.props.children, prop),
  ];
}

const box = () => NoticeBox({ text: "Bought.", closeLabel: "Dismiss notice" });

test("a notice said in place is shown, and goes after a few seconds", () => {
  announce("bought");
  expect(saidNotice()?.notice).toBe("bought");
  jest.advanceTimersByTime(SHOWN_MS - 1);
  expect(saidNotice()?.notice).toBe("bought");
  jest.advanceTimersByTime(1);
  expect(saidNotice()).toBeNull();
});

test("a notice stays while the pointer is on it and again while it holds focus", () => {
  announce("bought");
  holdNotice("hover", true);
  holdNotice("focus", true);
  jest.advanceTimersByTime(SHOWN_MS * 3);
  expect(saidNotice()?.notice).toBe("bought");
  holdNotice("hover", false);
  jest.advanceTimersByTime(SHOWN_MS * 3);
  expect(saidNotice()?.notice).toBe("bought");
  holdNotice("focus", false);
  jest.advanceTimersByTime(SHOWN_MS - 1);
  expect(saidNotice()?.notice).toBe("bought");
  jest.advanceTimersByTime(1);
  expect(saidNotice()).toBeNull();
});

test("the close button hides the notice", () => {
  announce("bought");
  const [close] = withProp(box(), "aria-label");
  if (!close) throw new Error("no close button");
  expect(close.props["aria-label"]).toBe("Dismiss notice");
  (close.props.onClick as () => void)();
  expect(saidNotice()).toBeNull();
});

test("Escape hides the notice, other keys do not, and the listener goes with it", () => {
  const target = new EventTarget();
  const press = (key: string, defaultPrevented = false) => {
    const event = Object.assign(new Event("keydown", { cancelable: true }), {
      key,
    });
    if (defaultPrevented) event.preventDefault();
    target.dispatchEvent(event);
  };
  announce("bought");
  const stop = closeOnEscape(target);
  press("a");
  press("Escape", true);
  expect(saidNotice()?.notice).toBe("bought");
  press("Escape");
  expect(saidNotice()).toBeNull();
  announce("bought");
  stop();
  press("Escape");
  expect(saidNotice()?.notice).toBe("bought");
});

test("a notice the page has no words for says nothing", () => {
  expect(noticeText(texts, "bought")).toBe("Bought.");
  expect(noticeText(texts, "gone")).toBeNull();
  expect(noticeText(texts, "toString")).toBeNull();
  expect(noticeText(texts, null)).toBeNull();
});

test("a notice that is gone leaves no timer behind", () => {
  announce("bought");
  holdNotice("hover", true);
  holdNotice("hover", false);
  expect(jest.getTimerCount()).toBe(1);
  announce(null);
  expect(jest.getTimerCount()).toBe(0);
});

test("a notice said again restarts the time and is written again for the screen reader", () => {
  announce("bought");
  const first = saidNotice();
  jest.advanceTimersByTime(4000);
  announce("bought");
  const second = saidNotice();
  expect(second).not.toBe(first);
  jest.advanceTimersByTime(4000);
  expect(saidNotice()?.notice).toBe("bought");
  jest.advanceTimersByTime(2000);
  expect(saidNotice()).toBeNull();
  const textKey = (seq: number) =>
    withProp(NoticeStatus({ text: "Bought.", seq }), "children").find(
      (el) => el.type === "span",
    )?.key;
  expect(textKey(2)).not.toBe(textKey(1));
});

test("the live region is in the page before there is anything to say", () => {
  const page = renderToStaticMarkup(<PageNotice texts={texts} />);
  expect(page).toMatch(/<output aria-live="polite"[^>]*><\/output>/);
  expect(page).not.toContain("<button");
  const said = renderToStaticMarkup(<NoticeStatus text="Bought." seq={1} />);
  expect(said).toMatch(/<output[^>]*><span>Bought\.<\/span><\/output>/);
});

test("the card shows the words, can be closed, and takes no taps outside its own box", () => {
  const shown = renderToStaticMarkup(box());
  expect(shown).toContain("Bought.");
  expect(shown).toContain('aria-label="Dismiss notice"');
  expect(shown).toMatch(/^<div class="[^"]*pointer-events-none/);
  expect(shown).toContain("pointer-events-auto");
});

test("the box holds the notice while the pointer is on it or focus is in it, each on its own", () => {
  const [card] = withProp(box(), "onMouseEnter");
  if (!card) throw new Error("no notice box");
  const call = (name: string) => (card.props[name] as () => void)();
  const survives = () => {
    jest.advanceTimersByTime(SHOWN_MS * 2);
    return saidNotice() !== null;
  };
  const goes = () => {
    jest.advanceTimersByTime(SHOWN_MS);
    return saidNotice() === null;
  };

  announce("bought");
  call("onMouseEnter");
  expect(survives()).toBe(true);
  call("onMouseLeave");
  expect(goes()).toBe(true);

  announce("bought");
  call("onFocus");
  expect(survives()).toBe(true);
  call("onBlur");
  expect(goes()).toBe(true);

  announce("bought");
  call("onMouseEnter");
  call("onFocus");
  call("onMouseLeave");
  expect(survives()).toBe(true);
  call("onBlur");
  expect(goes()).toBe(true);
});
