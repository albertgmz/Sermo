// The fields every entry of a catalog or palette has, for the edit page's `EditForm`. Server-safe.
//
// NameField, PositionField   `idPrefix` makes the input's id `<idPrefix>-<name>`; `defaultValue` is
//                            the entry's own, absent on the new-entry page. An empty position is
//                            the backend's default.
// ActiveField                `help` is the line next to the checkbox; a new entry starts active.

import { useTranslations } from "next-intl";
import { Field } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";

export function NameField({
  idPrefix,
  defaultValue,
}: {
  idPrefix: string;
  defaultValue?: string;
}) {
  const t = useTranslations("adminAppearance.entryFields");
  return (
    <Field name="name" label={t("name")} htmlFor={`${idPrefix}-name`}>
      <Input
        id={`${idPrefix}-name`}
        name="name"
        required
        defaultValue={defaultValue}
      />
    </Field>
  );
}

export function PositionField({
  idPrefix,
  defaultValue,
}: {
  idPrefix: string;
  defaultValue?: number;
}) {
  const t = useTranslations("adminAppearance.entryFields");
  return (
    <Field
      name="position"
      label={t("position")}
      htmlFor={`${idPrefix}-position`}
      help={t("positionHelp")}
    >
      <Input
        id={`${idPrefix}-position`}
        name="position"
        type="number"
        inputMode="numeric"
        defaultValue={defaultValue}
      />
    </Field>
  );
}

export function ActiveField({
  help,
  defaultChecked,
}: {
  help: string;
  defaultChecked: boolean;
}) {
  const t = useTranslations("adminAppearance.entryFields");
  return (
    <Field name="isActive" label={t("active")}>
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={defaultChecked}
          className="size-5"
        />
        {help}
      </label>
    </Field>
  );
}
