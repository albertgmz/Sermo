import { afterAll, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createFormatter } from "use-intl";

const pushed: string[] = [];
let locale: "en" | "es" = "en";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}));
const intl = { ...(await import("next-intl")) };
mock.module("next-intl", () => ({
  ...intl,
  useTranslations: () => (key: string) => key,
  useFormatter: () => createFormatter({ locale, timeZone: "UTC" }),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
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

const picker = () =>
  MonthPicker({ id: "m", value: "2026-09", min: "2026-08", max: "2026-10" });

type SelectProps = {
  name: string;
  defaultValue: string;
  children: ReactElement<{ value: string; children: string }>[];
  onChange: (event: { currentTarget: { value: string } }) => void;
};
const select = () => find(picker(), "select")?.props as SelectProps;

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

test("choosing a month opens its standing, in place", () => {
  pushed.length = 0;
  select().onChange({ currentTarget: { value: "2026-08" } });
  expect(pushed).toEqual(["/members/month?month=2026-08"]);
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
