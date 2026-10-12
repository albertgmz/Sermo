import { getTranslations } from "next-intl/server";
import { FieldRow } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import type { messages } from "@/i18n/messages";

// The rows of the settings forms. A row is named after its settings key: its label, help and unit
// are `adminSetup.fields.<key>` in the messages. The value is what the backend returned.
export type FieldKey = keyof typeof messages.adminSetup.fields;

export async function NumberRow({
  name,
  value,
}: {
  name: FieldKey;
  value: number;
}) {
  const t = await getTranslations("adminSetup.fields");
  const id = `field-${name}`;
  return (
    <FieldRow
      name={name}
      label={t(`${name}.label`)}
      htmlFor={id}
      help={t(`${name}.help`)}
    >
      <div className="flex items-center gap-2">
        <Input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          required
          defaultValue={value}
          aria-describedby={`${id}-help`}
        />
        {t.has(`${name}.unit` as `${typeof name}.label`) && (
          <span className="shrink-0 text-sm text-muted-foreground">
            {t(`${name}.unit` as `${typeof name}.label`)}
          </span>
        )}
      </div>
    </FieldRow>
  );
}

export async function SwitchRow({
  name,
  value,
}: {
  name: FieldKey;
  value: boolean;
}) {
  const t = await getTranslations("adminSetup.fields");
  const id = `field-${name}`;
  return (
    <FieldRow
      name={name}
      label={t(`${name}.label`)}
      htmlFor={id}
      help={t(`${name}.help`)}
    >
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input
          id={id}
          type="checkbox"
          name={name}
          defaultChecked={value}
          aria-describedby={`${id}-help`}
          className="size-5"
        />
        {t(`${name}.switch` as `${typeof name}.label`)}
      </label>
    </FieldRow>
  );
}

export async function TextRow({
  name,
  value,
  autoCapitalize,
}: {
  name: FieldKey;
  value: string | null;
  autoCapitalize?: "none";
}) {
  const t = await getTranslations("adminSetup.fields");
  const id = `field-${name}`;
  return (
    <FieldRow
      name={name}
      label={t(`${name}.label`)}
      htmlFor={id}
      help={t(`${name}.help`)}
    >
      <Input
        id={id}
        name={name}
        defaultValue={value ?? ""}
        autoCapitalize={autoCapitalize}
        aria-describedby={`${id}-help`}
      />
    </FieldRow>
  );
}
