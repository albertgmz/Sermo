import { getTranslations } from "next-intl/server";
import { FieldRow } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import type { messages } from "@/i18n/messages";
import { Shown } from "./shown";

// The rows of the settings forms. A row is named after its settings key: its label, help and unit
// are `adminSetup.fields.<key>` in the messages. The value is what the backend returned.
export type FieldKey = Exclude<
  keyof typeof messages.adminSetup.fields,
  "socialLinks" | "analytics"
>;

type FieldText = Awaited<
  ReturnType<typeof getTranslations<"adminSetup.fields">>
>;

// The row around a setting's control: label and help from the messages, and the control's id.
async function SettingRow({
  name,
  children,
}: {
  name: FieldKey;
  children: (id: string, t: FieldText) => React.ReactNode;
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
      {children(id, t)}
    </FieldRow>
  );
}

export function NumberRow({ name, value }: { name: FieldKey; value: number }) {
  return (
    <SettingRow name={name}>
      {(id, t) => (
        <div className="flex items-center gap-2">
          <Shown name={name} />
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
      )}
    </SettingRow>
  );
}

export function SwitchRow({ name, value }: { name: FieldKey; value: boolean }) {
  return (
    <SettingRow name={name}>
      {(id, t) => (
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <Shown name={name} />
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
      )}
    </SettingRow>
  );
}

// A row of ticked kinds (the formatting a signature may use, the forms Turnstile guards). The
// ticked ones are posted under the row's name; `options` pairs each kind with its label.
export async function ChecklistRow({
  name,
  options,
  value,
}: {
  name: "signatureFormats" | "turnstileForms";
  options: { kind: string; label: string; note?: string }[];
  value: readonly string[];
}) {
  const t = await getTranslations("adminSetup.fields");
  return (
    <FieldRow name={name} label={t(`${name}.label`)} help={t(`${name}.help`)}>
      <Shown name={name} />
      <fieldset className="grid min-w-0 gap-x-4 sm:grid-cols-2">
        <legend className="sr-only">{t(`${name}.label`)}</legend>
        {options.map(({ kind, label, note }) => (
          <div key={kind}>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name={name}
                value={kind}
                defaultChecked={value.includes(kind)}
                aria-describedby={note ? `${name}-${kind}-note` : undefined}
                className="size-5"
              />
              {label}
            </label>
            {note && (
              <p
                id={`${name}-${kind}-note`}
                className="text-xs text-pretty text-muted-foreground"
              >
                {note}
              </p>
            )}
          </div>
        ))}
      </fieldset>
    </FieldRow>
  );
}

// The write-only secret of a service: never shown, so the row says whether one is stored. Typing
// replaces it, the box removes it, leaving both alone keeps it.
export async function SecretRow({
  name,
  stored,
}: {
  name: "turnstileSecret";
  stored: boolean;
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
      <Shown name={name} />
      <Input
        id={id}
        name={name}
        type="password"
        autoComplete="new-password"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={stored ? t(`${name}.placeholderStored`) : undefined}
        aria-describedby={`${id}-help`}
      />
      <p role="status" className="text-xs font-medium">
        {stored ? t(`${name}.stored`) : t(`${name}.notStored`)}
      </p>
      {stored && (
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name={`${name}Remove`} className="size-5" />
          {t(`${name}.remove`)}
        </label>
      )}
    </FieldRow>
  );
}

export function TextRow({
  name,
  value,
  autoCapitalize,
}: {
  name: FieldKey;
  value: string | null;
  autoCapitalize?: "none";
}) {
  return (
    <SettingRow name={name}>
      {(id) => (
        <>
          <Shown name={name} />
          <Input
            id={id}
            name={name}
            defaultValue={value ?? ""}
            autoCapitalize={autoCapitalize}
            aria-describedby={`${id}-help`}
          />
        </>
      )}
    </SettingRow>
  );
}
