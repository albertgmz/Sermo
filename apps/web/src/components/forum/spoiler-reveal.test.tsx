import { expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const calls: [string, number, number][] = [];
let answer: { html: string } | null = { html: "<p>secret</p>" };
mock.module("@/components/forum/spoiler-action", () => ({
  revealSpoiler: async (type: string, id: number, position: number) => {
    calls.push([type, id, position]);
    return answer;
  },
}));
const { SpoilerReveal } = await import("./spoiler-reveal");

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

function handler() {
  const element = SpoilerReveal({
    content: { type: "post", id: 7 },
    children: null,
  }) as ReactElement<{ onClick: (event: unknown) => Promise<void> }>;
  return element.props.onClick;
}

test("pressing a spoiler asks for it by position and puts it in place", async () => {
  calls.length = 0;
  answer = { html: "<p>secret</p>" };
  const dom = fakeDom();
  await handler()(dom.event);
  expect(calls).toEqual([["post", 7, 3]]);
  expect(dom.holder.innerHTML).toBe("<p>secret</p>");
  expect(dom.holder.classes).toEqual(["bb-spoiler-open"]);
  expect(dom.holder.focused).toBe(true);
});

test("a refusal leaves the button pressable again and marks it", async () => {
  calls.length = 0;
  answer = null;
  const dom = fakeDom();
  await handler()(dom.event);
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
  await handler()({
    target: { closest: () => null },
    currentTarget: { contains: () => true },
  });
  expect(calls).toEqual([]);
});
