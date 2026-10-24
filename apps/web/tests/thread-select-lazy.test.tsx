import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ComponentType, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The select of the "use an item" form is fetched when the member first reaches for it; until then
// the page holds a plain button. The two must look and read the same, so nothing moves when the real
// one arrives, and the page's first load must not hold Base UI's select.

type Captured = {
  load: () => Promise<{ default: ComponentType<Record<string, unknown>> }>;
  popup: Record<string, unknown>;
  opening: string;
  trigger: (lazy: Record<string, unknown>) => ReactElement;
};
let captured: Captured | undefined;
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: Captured) => {
    captured = props;
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { ThreadSelect } = await import(
  "@/app/[locale]/(main)/credits/thread-select"
);

const props = {
  threads: [
    { value: "1", label: "First" },
    { value: "2", label: "Second" },
  ],
  label: "Thread for Bump",
  placeholder: "Choose a thread",
  triggerClass: "w-full h-10",
};

function button(html: string) {
  const tag = /<button((?:\s[^>]*)?)>/.exec(html)?.[1] ?? "";
  const attributes: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/\s([^\s=]+)(?:="([^"]*)")?/g))
    attributes[name] = value ?? "";
  for (const bookkeeping of Object.keys(attributes))
    if (
      /^(id|tabindex|aria-expanded|aria-controls|data-base-ui.*|data-popup.*|data-pressed)$/.test(
        bookkeeping,
      )
    )
      delete attributes[bookkeeping];
  return attributes;
}

test("the plain button is the real select's button as far as the page can tell", async () => {
  const plain = renderToStaticMarkup(<ThreadSelect {...props} />);
  const Real = (await (captured as Captured).load()).default;
  const real = renderToStaticMarkup(
    <Real {...(captured as Captured).popup} openedBy="pointer" />,
  );
  const { type: _plainType, ...plainAttributes } = button(plain);
  const { type: _realType, ...realAttributes } = button(real);
  expect(plainAttributes).toEqual(realAttributes);
  expect(plain).toContain("Choose a thread");
  expect(real).toContain("Choose a thread");
});

test("the select asks for the list the way a menu does, and the page does not hold its code", () => {
  renderToStaticMarkup(<ThreadSelect {...props} />);
  expect((captured as Captured).opening).toBe("menu");
  const code = readFileSync(
    "src/app/[locale]/(main)/credits/use-form.tsx",
    "utf8",
  );
  expect(code).not.toContain("@/components/ui/select");
});
