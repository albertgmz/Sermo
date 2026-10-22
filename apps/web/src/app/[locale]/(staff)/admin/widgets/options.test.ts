import { expect, test } from "bun:test";
import { WIDGET_OPTIONS, WidgetKind } from "@sermo/core/contracts";
import { messages } from "@/i18n/messages";
import es from "../../../../../../messages/es/admin-widgets.json";
import { fieldsOf, optionDefaults, optionFields, optionsFrom } from "./options";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const refuse = (min: number, max: number) => `${min}-${max}`;

test("the options of each type are read from the backend's schema", () => {
  expect(optionFields("forumStats")).toEqual([
    {
      name: "limit",
      kind: "number",
      min: 5,
      max: 20,
      required: false,
      byDefault: 10,
    },
    { name: "topPosters", kind: "boolean" },
  ]);
  expect(optionFields("rankedThreads")).toEqual([
    {
      name: "by",
      kind: "choice",
      values: [
        "latestPosts",
        "latestThreads",
        "mostReplied",
        "mostReacted",
        "mostViewed",
      ],
      required: false,
    },
    {
      name: "limit",
      kind: "number",
      min: 1,
      max: 20,
      required: false,
      byDefault: 5,
    },
  ]);
  expect(optionFields("recentlyActive")).toEqual([
    { name: "window", kind: "choice", values: ["15m", "24h"], required: false },
    {
      name: "limit",
      kind: "number",
      min: 1,
      max: 200,
      required: false,
      byDefault: 50,
    },
  ]);
  const [body] = optionFields("text");
  expect(body).toMatchObject({ name: "body", kind: "text" });
  expect(optionFields("featured")).toEqual([]);
  expect(optionDefaults("forumStats")).toEqual({
    limit: 10,
    topPosters: false,
  });
  expect(optionDefaults("text")).toEqual({});
});

// A type or an option the backend gains needs its words in both languages: this fails until they
// are written, so the form never shows a missing message.
test("every type and every option has its words in English and Spanish", () => {
  for (const words of [messages.adminWidgets, es]) {
    for (const type of WidgetKind.options) {
      expect(words.types[type].name, type).toBeTruthy();
      expect(words.types[type].help, type).toBeTruthy();
      const labelled = (
        words.options as Record<string, Record<string, object>>
      )[type];
      for (const field of optionFields(type)) {
        const entry = labelled?.[field.name] as Record<string, string>;
        expect(entry?.label, `${type}.${field.name}`).toBeTruthy();
        expect(entry?.help, `${type}.${field.name}`).toBeTruthy();
        if (field.kind === "boolean")
          expect(entry?.switch, `${type}.${field.name}`).toBeTruthy();
        if (field.kind === "choice")
          for (const value of field.values)
            expect(
              (words.optionValues as Record<string, string>)[value],
              value,
            ).toBeTruthy();
      }
    }
  }
  expect(Object.keys(WIDGET_OPTIONS)).toEqual([...WidgetKind.options]);
});

test("a form is read into the options of its type", () => {
  expect(
    optionsFrom(
      "forumStats",
      form([
        ["option.limit", " 8 "],
        ["option.topPosters", "on"],
      ]),
      refuse,
    ),
  ).toEqual({ options: { limit: 8, topPosters: true } });
  expect(
    optionsFrom("forumStats", form([["option.limit", "8"]]), refuse),
  ).toEqual({ options: { limit: 8, topPosters: false } });
  expect(
    optionsFrom(
      "rankedThreads",
      form([
        ["option.by", "mostViewed"],
        ["option.limit", "3"],
      ]),
      refuse,
    ),
  ).toEqual({ options: { by: "mostViewed", limit: 3 } });
  expect(
    optionsFrom("text", form([["option.body", "a\r\nb"]]), refuse),
  ).toEqual({ options: { body: "a\nb" } });
  expect(optionsFrom("featured", form([]), refuse)).toEqual({ options: {} });
});

test("a number outside the range, or not a whole number, is refused with the range", () => {
  for (const typed of ["4", "21", "abc", "7.5", "1e1"]) {
    expect(
      optionsFrom("forumStats", form([["option.limit", typed]]), refuse),
      typed,
    ).toEqual({ fields: { "option.limit": "5-20" } });
  }
});

test("a number with a default may be left empty and then takes the default; a required one may not", () => {
  expect(
    optionsFrom("forumStats", form([["option.limit", " "]]), refuse),
  ).toEqual({ options: { topPosters: false } });
  expect(
    fieldsOf({ properties: { n: { type: "integer" } }, required: ["n"] }),
  ).toEqual([
    {
      name: "n",
      kind: "number",
      min: Number.MIN_SAFE_INTEGER,
      max: Number.MAX_SAFE_INTEGER,
      required: true,
    },
  ]);
});

test("a shape the form cannot draw is an error, not a text box", () => {
  for (const property of [
    { anyOf: [{ type: "string" }, { type: "null" }] },
    { type: "array" },
    { type: "object" },
    { type: "number" },
    { type: "integer", exclusiveMinimum: 0 },
    {},
  ])
    expect(() => fieldsOf({ properties: { odd: property } })).toThrow(/odd/);
  // Every type there is today can be drawn.
  for (const type of WidgetKind.options)
    expect(() => optionFields(type), type).not.toThrow();
});
