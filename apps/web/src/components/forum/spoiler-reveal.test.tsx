import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const calls: [string, number, number][] = [];
let answer: { html: string } | null | "throw" = { html: "<p>secret</p>" };
mock.module("@/components/forum/spoiler-action", () => ({
  revealSpoiler: async (type: string, id: number, position: number) => {
    calls.push([type, id, position]);
    if (answer === "throw") throw new Error("network");
    return answer;
  },
}));
const { openSpoiler, SpoilerReveal } = await import("./spoiler-reveal");

// The few things of the DOM the handler reads and writes.
function fakeDom(disabled = false) {
  const holder = {
    dataset: { spoiler: "3" },
    innerHTML: "",
    isConnected: true,
    tabIndex: 0,
    focused: false,
    classes: [] as string[],
    classList: { add: (name: string) => holder.classes.push(name) },
    focus: () => {
      holder.focused = true;
    },
  };
  const attributes = new Map<string, string>();
  const button = {
    disabled,
    parentElement: holder,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  const event = {
    target: { closest: () => button },
    currentTarget: { contains: () => true },
  };
  return { holder, button, attributes, event };
}

const content = { type: "post" as const, id: 7 };
const handler = () => (event: ReturnType<typeof fakeDom>["event"]) =>
  openSpoiler(event.target as never, event.currentTarget as never, content);

test("pressing a spoiler asks for it by position and puts it in place", async () => {
  calls.length = 0;
  answer = { html: "<p>secret</p>" };
  const dom = fakeDom();
  expect(await handler()(dom.event)).toBe(true);
  expect(calls).toEqual([["post", 7, 3]]);
  expect(dom.holder.innerHTML).toBe("<p>secret</p>");
  expect(dom.holder.classes).toEqual(["bb-spoiler-open"]);
  expect(dom.holder.focused).toBe(true);
});

test("a refusal leaves the button pressable again and marks it", async () => {
  calls.length = 0;
  answer = null;
  const dom = fakeDom();
  expect(await handler()(dom.event)).toBe(false);
  expect(dom.holder.innerHTML).toBe("");
  expect(dom.button.disabled).toBe(false);
  expect(dom.attributes.get("aria-invalid")).toBe("true");
  expect(dom.attributes.has("aria-busy")).toBe(false);
});

test("a click outside a spoiler button, or on a disabled one, asks for nothing", async () => {
  calls.length = 0;
  answer = { html: "x" };
  const disabled = fakeDom(true);
  await handler()(disabled.event);
  await openSpoiler(
    { closest: () => null } as never,
    { contains: () => true },
    content,
  );
  expect(calls).toEqual([]);
});

test("a spoiler that fails to load leaves the button pressable and marked", async () => {
  const dom = fakeDom();
  answer = "throw";
  expect(
    await openSpoiler(
      dom.event.target as never,
      dom.event.currentTarget as never,
      content,
    ),
  ).toBe(false);
  expect(dom.button.disabled).toBe(false);
  expect(dom.attributes.get("aria-invalid")).toBe("true");
});

test("a polite live region is there before any message", () => {
  const html = renderToStaticMarkup(
    withIntl(<SpoilerReveal content={content}>{null}</SpoilerReveal>),
  );
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-live="polite"');
});
