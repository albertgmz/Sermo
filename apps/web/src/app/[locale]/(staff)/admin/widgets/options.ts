import { WIDGET_OPTIONS } from "@sermo/core/contracts";
import * as z from "zod";
import type { WidgetType } from "@/components/widgets/widget-types";

// The options each widget type takes, read from the backend's own schemas (`WIDGET_OPTIONS`), so a
// type or an option added there is on the form with no change here but its words. `required` is
// whether the schema asks for it: one it does not (it has a default) may be left empty, and then
// takes the backend's default.
export type OptionField =
  | {
      name: string;
      kind: "number";
      min: number;
      max: number;
      required: boolean;
      byDefault?: number;
    }
  | { name: string; kind: "boolean" }
  | { name: string; kind: "choice"; values: string[]; required: boolean }
  | { name: string; kind: "text"; max: number; required: boolean };

type Property = {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
};

type Schema = { properties?: Record<string, Property>; required?: string[] };

const schemaOf = (type: WidgetType) =>
  z.toJSONSchema(WIDGET_OPTIONS[type], { io: "input" }) as Schema;

const properties = (type: WidgetType) =>
  Object.entries(schemaOf(type).properties ?? {});

// The control each option of a schema needs. A shape the form cannot draw (an optional or nullable
// value, a list, a decimal, an exclusive bound) throws, so a type that gains one fails the tests
// instead of showing a control that sends something the backend refuses.
export function fieldsOf(schema: Schema): OptionField[] {
  const asked = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const required = asked.has(name);
    const bounded = Object.keys(property).filter((key) =>
      key.startsWith("exclusive"),
    );
    if (bounded.length === 0) {
      if (property.type === "string" && property.enum)
        return { name, kind: "choice", values: property.enum, required };
      if (property.type === "boolean") return { name, kind: "boolean" };
      if (property.type === "integer")
        return {
          name,
          kind: "number",
          min: property.minimum ?? Number.MIN_SAFE_INTEGER,
          max: property.maximum ?? Number.MAX_SAFE_INTEGER,
          required,
          ...(typeof property.default === "number" && {
            byDefault: property.default,
          }),
        };
      if (property.type === "string" && !property.enum)
        return {
          name,
          kind: "text",
          max: property.maxLength ?? Number.MAX_SAFE_INTEGER,
          required,
        };
    }
    throw new Error(
      `The widget option "${name}" has a shape the form cannot draw.`,
    );
  });
}

export const optionFields = (type: WidgetType) => fieldsOf(schemaOf(type));

// The default of each option that has one, for a form that starts a new widget.
export function optionDefaults(type: WidgetType): Record<string, unknown> {
  return Object.fromEntries(
    properties(type).flatMap(([name, property]) =>
      property.default === undefined ? [] : [[name, property.default]],
    ),
  );
}

// The prefix of a form field that carries an option, so that no option can take the name of one of
// the widget's own fields.
export const OPTION_PREFIX = "option.";

const WHOLE = /^-?\d{1,15}$/;

// The options typed in a form, as the backend takes them, or the field errors to show. A number out
// of range is refused here with the range; every other check is the backend's.
export function optionsFrom(
  type: WidgetType,
  formData: FormData,
  refuse: (min: number, max: number) => string,
): { options: Record<string, unknown> } | { fields: Record<string, string> } {
  const options: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  for (const field of optionFields(type)) {
    const name = `${OPTION_PREFIX}${field.name}`;
    const sent = formData.get(name);
    const value = typeof sent === "string" ? sent : "";
    switch (field.kind) {
      case "boolean":
        options[field.name] = sent !== null;
        break;
      case "number": {
        // Left empty, an option with a default takes it.
        if (value.trim() === "" && !field.required) break;
        const number = WHOLE.test(value.trim()) ? Number(value.trim()) : null;
        if (number === null || number < field.min || number > field.max)
          fields[name] = refuse(field.min, field.max);
        else options[field.name] = number;
        break;
      }
      case "choice":
        if (value !== "" || field.required) options[field.name] = value;
        break;
      case "text":
        // A browser sends the line breaks of a text area as CRLF; the source is kept with LF.
        options[field.name] = value.replaceAll("\r\n", "\n");
        break;
    }
  }
  return Object.keys(fields).length > 0 ? { fields } : { options };
}
