import { afterAll, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createFormatter } from "use-intl";

let locale: "en" | "es" = "en";

const intl = { ...(await import("next-intl")) };
mock.module("next-intl", () => ({
  ...intl,
  useTranslations: () => (key: string) => key,
  useFormatter: () => createFormatter({ locale, timeZone: "UTC" }),
}));
afterAll(() => {
  mock.module("next-intl", () => intl);
});

const { MonthPicker } = await import("./month-picker");

// The first element of a tree of elements that is a `tag`.
function find(node: ReactNode, tag: string): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, tag);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === tag ? node : find(node.props.children, tag);
}

const picker = (
  more: { compact?: boolean; onPick?: (month: string) => void } = {},
) =>
  MonthPicker({
    id: "m",
    value: "2026-09",
    min: "2026-08",
    max: "2026-10",
    ...more,
  });

type SelectProps = {
  name: string;
  defaultValue: string;
  children: ReactElement<{ value: string; children: string }>[];
  className: string;
  ref: (node: { value: string } | null) => void;
  onChange: (event: {
    currentTarget: { value: string; form: { requestSubmit: () => void } };
  }) => void;
};
const select = (more?: Parameters<typeof picker>[0]) =>
  find(picker(more), "select")?.props as SelectProps;

test("the picker is a select of the months by name, newest first, set to the month shown", () => {
  locale = "en";
  const field = select();
  expect(field.name).toBe("month");
  expect(field.defaultValue).toBe("2026-09");
  expect(
    field.children.map((option) => [option.props.value, option.props.children]),
  ).toEqual([
    ["2026-10", "October 2026"],
    ["2026-09", "September 2026"],
    ["2026-08", "August 2026"],
  ]);
});

test("the month names follow the language", () => {
  locale = "es";
  expect(select().children.map((option) => option.props.children)).toEqual([
    "octubre de 2026",
    "septiembre de 2026",
    "agosto de 2026",
  ]);
});

// Where the picker sits in a page that changes in place (a switch around it takes the form's
// submission), choosing a month sends the form; the browser never leaves the page.
test("choosing a month sends its form, which the page around it answers in place", () => {
  let sent = 0;
  select().onChange({
    currentTarget: {
      value: "2026-08",
      form: { requestSubmit: () => sent++ },
    },
  });
  expect(sent).toBe(1);
});

test("where a picker is given what to do with the month chosen, it does that and sends nothing", () => {
  const picked: string[] = [];
  let sent = 0;
  select({ onPick: (month) => picked.push(month) }).onChange({
    currentTarget: {
      value: "2026-08",
      form: { requestSubmit: () => sent++ },
    },
  });
  expect(picked).toEqual(["2026-08"]);
  expect(sent).toBe(0);
});

// "Ver" is for a browser without scripts; with them the month chosen is the answer.
test("the submit button is drawn only for a browser without scripts", () => {
  const html = renderToStaticMarkup(picker());
  expect(html).toMatch(/<noscript><button[^>]*type="submit"/);
  expect(html.replace(/<noscript>.*?<\/noscript>/, "")).not.toContain(
    'type="submit"',
  );
});

test("a compact picker's select takes its own width instead of the whole row", () => {
  expect(select().className).toContain("flex-1");
  expect(select({ compact: true }).className).not.toContain("flex-1");
});

test("a month outside the range named by the address stays in the list, chosen", () => {
  const field = find(
    MonthPicker({ id: "m", value: "2019-03", min: "2026-08", max: "2026-10" }),
    "select",
  )?.props as SelectProps;
  expect(field.children.map((option) => option.props.value)).toEqual([
    "2026-10",
    "2026-09",
    "2026-08",
    "2019-03",
  ]);
});

// The select is uncontrolled and stays the same element (the keyboard that chose a month stays on
// it); it is set to the month shown whenever that is not what it shows (back, forward, a link to
// another month).
test("the select is set to the month shown when it shows another", () => {
  const refOf = (value: string) => {
    const field = find(
      MonthPicker({ id: "m", value, min: "2026-08", max: "2026-10" }),
      "select",
    );
    return (field?.props as SelectProps | undefined)?.ref ?? (() => {});
  };
  const node = { value: "2026-09" };
  refOf("2026-08")(node);
  expect(node.value).toBe("2026-08");
  refOf("2026-08")(null);
});
