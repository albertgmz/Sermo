import { widgetPhonesByDefault } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WidgetType } from "@/components/widgets/widget-types";
import { createWidget, saveWidget } from "./actions";
import type { WidgetItem } from "./data";
import { POSITIONS_IN_ORDER } from "./drawn";
import {
  OPTION_PREFIX,
  type OptionField,
  optionDefaults,
  optionFields,
} from "./options";
import type { Position } from "./positions";

// One option of a widget type, as the control its kind needs. The labels are the form's own
// (`options.<type>.<name>`); the range, choices and default come from the backend's schema.
async function OptionControl({
  type,
  field,
  value,
}: {
  type: WidgetType;
  field: OptionField;
  value: unknown;
}) {
  const t = await getTranslations("adminWidgets");
  const name = `${OPTION_PREFIX}${field.name}`;
  const id = `widget-${name.replace(".", "-")}`;
  const key = `options.${type}.${field.name}` as const;
  const describedBy = `${id}-help`;
  const control = (() => {
    switch (field.kind) {
      case "number":
        return (
          <Input
            id={id}
            name={name}
            type="number"
            inputMode="numeric"
            required={field.required}
            min={field.min}
            max={field.max}
            placeholder={
              field.byDefault === undefined
                ? undefined
                : String(field.byDefault)
            }
            defaultValue={typeof value === "number" ? value : undefined}
            aria-describedby={describedBy}
          />
        );
      case "boolean":
        return (
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id={id}
              type="checkbox"
              name={name}
              defaultChecked={value === true}
              className="size-5"
              aria-describedby={describedBy}
            />
            {t(`${key}.switch` as never)}
          </label>
        );
      case "choice":
        return (
          <select
            id={id}
            name={name}
            defaultValue={typeof value === "string" ? value : undefined}
            className={selectClass}
            aria-describedby={describedBy}
          >
            {field.values.map((choice) => (
              <option key={choice} value={choice}>
                {t(`optionValues.${choice}` as never)}
              </option>
            ))}
          </select>
        );
      case "text":
        return (
          <Textarea
            id={id}
            name={name}
            required={field.required}
            rows={8}
            maxLength={field.max}
            defaultValue={typeof value === "string" ? value : undefined}
            aria-describedby={describedBy}
          />
        );
    }
  })();
  return (
    <Field
      name={name}
      label={t(`${key}.label` as never)}
      htmlFor={id}
      help={t(`${key}.help` as never)}
    >
      {control}
    </Field>
  );
}

// The form of a widget's own page: with `widget` it edits that widget (its type stays), without it
// adds one of `type` (chosen on the step before), at `position` if the address named one.
export async function WidgetForm({
  type,
  widget,
  position,
}: {
  type: WidgetType;
  widget?: WidgetItem;
  position?: Position;
}) {
  const t = await getTranslations("adminWidgets");
  const fields = optionFields(type);
  const stored: Record<string, unknown> = widget
    ? widget.options
    : optionDefaults(type);
  const chosen = widget?.position ?? position;
  return (
    <EditForm
      action={widget ? saveWidget : createWidget}
      submit={widget ? t("form.save") : t("form.add")}
    >
      {widget && <input type="hidden" name="id" value={widget.id} />}
      <input type="hidden" name="type" value={type} />
      <FieldGroup legend={t("form.widget")}>
        <Field name="type" label={t("form.type")}>
          <p className="min-h-8 pt-1.5 text-sm font-medium">
            {t(`types.${type}.name`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`types.${type}.help`)}
          </p>
        </Field>
        <Field
          name="position"
          label={t("form.position")}
          htmlFor="widget-position"
          help={t("form.positionHelp")}
        >
          <select
            id="widget-position"
            name="position"
            required
            defaultValue={chosen ?? ""}
            className={selectClass}
            aria-describedby="widget-position-help"
          >
            {chosen === undefined && (
              <option value="" disabled>
                {t("form.positionChoose")}
              </option>
            )}
            {POSITIONS_IN_ORDER.map((place) => (
              <option key={place} value={place}>
                {t(`positions.${place}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          name="title"
          label={t("form.title")}
          htmlFor="widget-title"
          help={t("form.titleHelp")}
        >
          <Input
            id="widget-title"
            name="title"
            maxLength={100}
            defaultValue={widget?.title ?? ""}
            placeholder={t("form.titlePlaceholder")}
            aria-describedby="widget-title-help"
          />
        </Field>
        <Field
          name="isEnabled"
          label={t("form.enabled")}
          htmlFor="widget-enabled"
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="widget-enabled"
              type="checkbox"
              name="isEnabled"
              defaultChecked={widget ? widget.isEnabled : true}
              className="size-5"
            />
            {t("form.enabledSwitch")}
          </label>
        </Field>
        <Field
          name="phones"
          label={t("form.phones")}
          htmlFor="widget-phones"
          help={t("form.phonesHelp")}
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="widget-phones"
              type="checkbox"
              name="phones"
              defaultChecked={
                widget ? widget.phones : widgetPhonesByDefault(type)
              }
              className="size-5"
              aria-describedby="widget-phones-help"
            />
            {t("form.phonesSwitch")}
          </label>
        </Field>
      </FieldGroup>
      {fields.length > 0 && (
        <FieldGroup legend={t("form.options")}>
          {fields.map((field) => (
            <OptionControl
              key={field.name}
              type={type}
              field={field}
              value={stored[field.name]}
            />
          ))}
        </FieldGroup>
      )}
      <FieldGroup legend={t("form.audience")}>
        <RuleField place="widget" owner={widget?.id} rule={widget?.rule} />
      </FieldGroup>
    </EditForm>
  );
}
