import { WIDGET_OPTIONS } from "@sermo/core/contracts";
import * as z from "zod";
import type { WidgetType } from "@/components/widgets/widget-types";

// The options each widget type takes, read from the backend's own schemas (`WIDGET_OPTIONS`), so a
// type or an option added there is on the form with no change here but its words.
export type OptionField =
  | { name: string; kind: "number"; min: number; max: number }
  | { name: string; kind: "boolean" }
  | { name: string; kind: "choice"; values: string[] }
  | { name: string; kind: "text"; max: number };

type Property = {
  type?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
};

const properties = (type: WidgetType) =>
  Object.entries(
    (
      z.toJSONSchema(WIDGET_OPTIONS[type], { io: "input" }) as {
        properties?: Record<string, Property>;
      }
    ).properties ?? {},
  );

export function optionFields(type: WidgetType): OptionField[] {
  return properties(type).map(([name, property]) => {
    if (property.enum)
      return { name, kind: "choice", values: property.enum } as const;
    if (property.type === "boolean") return { name, kind: "boolean" } as const;
    if (property.type === "integer" || property.type === "number")
      return {
        name,
        kind: "number",
        min: property.minimum ?? 0,
        max: property.maximum ?? Number.MAX_SAFE_INTEGER,
      } as const;
    return { name, kind: "text", max: property.maxLength ?? 10000 } as const;
  });
}

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
        const number = WHOLE.test(value.trim()) ? Number(value.trim()) : null;
        if (number === null || number < field.min || number > field.max)
          fields[name] = refuse(field.min, field.max);
        else options[field.name] = number;
        break;
      }
      case "choice":
        options[field.name] = value;
        break;
      case "text":
        // A browser sends the line breaks of a text area as CRLF; the source is kept with LF.
        options[field.name] = value.replaceAll("\r\n", "\n");
        break;
    }
  }
  return Object.keys(fields).length > 0 ? { fields } : { options };
}
