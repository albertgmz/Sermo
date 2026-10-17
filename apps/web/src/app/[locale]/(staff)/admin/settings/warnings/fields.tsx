import { Field } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";

// The rows of the warning forms, as `Field`s: an input (its id is `<idPrefix>-<name>`) and a
// checkbox with its own line.
export function InputField({
  name,
  label,
  idPrefix,
  help,
  ...input
}: Omit<React.ComponentProps<typeof Input>, "id" | "name"> & {
  name: string;
  label: React.ReactNode;
  idPrefix: string;
  help?: React.ReactNode;
}) {
  const id = `${idPrefix}-${name}`;
  return (
    <Field name={name} label={label} htmlFor={id} help={help}>
      <Input
        id={id}
        name={name}
        aria-describedby={help ? `${id}-help` : undefined}
        {...input}
      />
    </Field>
  );
}

export function CheckField({
  name,
  label,
  text,
  defaultChecked,
}: {
  name: string;
  label: React.ReactNode;
  text: React.ReactNode;
  defaultChecked: boolean;
}) {
  return (
    <Field name={name} label={label}>
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          className="size-5"
        />
        {text}
      </label>
    </Field>
  );
}
