import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A server render never runs effects, so they are collected and run by hand; the refs and the
// closures of that one render are the ones the panel would keep.
const react = await import("react");
const effects: (() => void)[] = [];
mock.module("react", () => ({
  ...react,
  useEffect: (effect: () => void) => {
    effects.push(effect);
  },
  useTransition: () => [false, (run: () => void) => run()],
}));
mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
let change: ((open: boolean) => void) | undefined;
mock.module("@/components/layout/header-panel", () => ({
  HeaderPanel: (props: { onOpenChange?: (open: boolean) => void }) => {
    change = props.onOpenChange;
    return null;
  },
}));

const { LoadedPanel } = await import("./loaded-panel");

afterAll(() => {
  mock.module("react", () => react);
});

test("the rows are fetched again for a new unread count only under an open panel", async () => {
  let loads = 0;
  renderToStaticMarkup(
    createElement(LoadedPanel, {
      label: "Alerts",
      title: "Alerts",
      unread: 1,
      icon: null,
      loadingLabel: "Loading",
      footer: null,
      load: async () => {
        loads += 1;
        return null;
      },
    }),
  );
  const unreadChanged = () => {
    for (const effect of effects) effect();
  };
  expect(change).toBeDefined();

  unreadChanged();
  expect(loads).toBe(0);

  change?.(true);
  expect(loads).toBe(1);
  unreadChanged();
  expect(loads).toBe(2);

  change?.(false);
  unreadChanged();
  expect(loads).toBe(2);

  change?.(true);
  expect(loads).toBe(3);
});
