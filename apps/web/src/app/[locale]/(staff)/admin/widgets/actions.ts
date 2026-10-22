"use server";

import {
  WidgetKind,
  widgetsCreate,
  widgetsDelete,
  widgetsDuplicate,
  widgetsReorder,
  widgetsUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  ruleOf,
  ruleRefusal,
  text,
  whole,
} from "../groups/form-errors";
import { OPTION_PREFIX, optionFields, optionsFrom } from "./options";
import { asPosition } from "./positions";

const BACK = "/admin/widgets";
const FIELDS = ["position", "title", "rule", "phones", "isEnabled"];

type Parsed = Omit<z.input<typeof widgetsUpdate.input>, "widgetId">;

// The fields of the widget form as the backend takes them, or the state to show when one is not
// usable. A widget's type is chosen before its form, so the form carries it.
async function fields(
  formData: FormData,
): Promise<Parsed | { fields: Record<string, string> }> {
  const t = await getTranslations("adminWidgets.errors");
  const type = WidgetKind.safeParse(text(formData, "type"));
  if (!type.success) return { fields: { type: t("type") } };
  const position = asPosition(text(formData, "position"));
  if (position === null) return { fields: { position: t("position") } };
  const rule = ruleOf(formData);
  if (rule === null) return ruleRefusal(formData);
  const options = optionsFrom(type.data, formData, (min, max) =>
    t("number", { min, max }),
  );
  if ("fields" in options) return options;
  const title = text(formData, "title").trim();
  return {
    position,
    type: type.data,
    options: options.options,
    title: title === "" ? null : title,
    phones: formData.get("phones") !== null,
    isEnabled: formData.get("isEnabled") !== null,
    rule,
  };
}

// A refusal that names an option is shown under that option's field.
function failure(error: unknown) {
  if (error instanceof SermoError && error.issues) {
    const named = new Set(
      WidgetKind.options.flatMap((type) =>
        optionFields(type).map((field) => field.name),
      ),
    );
    return formFailure(
      new SermoError(
        error.code,
        error.status,
        error.message,
        error.issues.map((issue) => {
          const [first, second] = Array.isArray(issue.path) ? issue.path : [];
          return first === "options" &&
            typeof second === "string" &&
            named.has(second)
            ? { ...issue, path: [`${OPTION_PREFIX}${second}`] }
            : issue;
        }),
      ),
      [...FIELDS, ...[...named].map((name) => `${OPTION_PREFIX}${name}`)],
    );
  }
  return formFailure(error, FIELDS);
}

export async function createWidget(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const input = await fields(formData);
  if ("fields" in input) return input;
  let created: number;
  try {
    created = (await call(widgetsCreate, input)).id;
  } catch (error) {
    return failure(error);
  }
  redirect(`${BACK}/${created}?notice=added`);
}

export async function saveWidget(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminWidgets.errors");
  const widgetId = parseId(text(formData, "id"));
  if (widgetId === null) return { error: t("id") };
  const input = await fields(formData);
  if ("fields" in input) return input;
  try {
    await call(widgetsUpdate, { widgetId, ...input });
  } catch (error) {
    return failure(error);
  }
  redirect(`${BACK}/${widgetId}?notice=saved`);
}

// A copy goes to the end of the position chosen (the widget's own when none is), and the page of
// the copy opens.
export async function duplicateWidget(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminWidgets.errors");
  const widgetId = parseId(text(formData, "id"));
  if (widgetId === null) return { error: t("id") };
  const chosen = text(formData, "position");
  const position = chosen === "" ? undefined : asPosition(chosen);
  if (position === null) return { fields: { position: t("position") } };
  let copy: number;
  try {
    copy = (
      await call(widgetsDuplicate, {
        widgetId,
        ...(position !== undefined && { position }),
      })
    ).id;
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${BACK}/${copy}?notice=duplicated`);
}

export async function removeWidget(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminWidgets.errors");
  const widgetId = parseId(text(formData, "id"));
  if (widgetId === null) return { error: t("id") };
  try {
    await call(widgetsDelete, { widgetId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${BACK}?notice=deleted`);
}

// The order of one position: every widget of it with its number (`order.<id>`), which is sorted
// into the list of ids the backend takes. The backend refuses a list that is not the whole
// position, so a widget added or deleted meanwhile asks for the page to be drawn again.
export async function saveOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminWidgets.errors");
  const position = asPosition(text(formData, "position"));
  if (position === null) return { error: t("position") };
  const numbered: { id: number; order: number }[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("order.") || typeof value !== "string") continue;
    const id = parseId(name.slice("order.".length));
    const order = whole(value);
    if (id === null) return { error: t("id") };
    if (order === null) return { error: t("order") };
    numbered.push({ id, order });
  }
  try {
    await call(widgetsReorder, {
      position,
      ids: numbered
        .sort((a, b) => a.order - b.order || a.id - b.id)
        .map(({ id }) => id),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${BACK}?notice=ordered`);
}
