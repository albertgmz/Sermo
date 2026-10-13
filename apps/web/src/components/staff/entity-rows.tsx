// The rows the entity forms of the administration panel have in common. Server-safe.
//
// InputRow props
//   name      The input's name; also the key of its error line and the end of its id.
//   label     The row's label.
//   idPrefix  The form's id prefix; the input's id is `<idPrefix>-<name>`.
//   help      Optional help text under the input.
//   ...rest   Passed to the `Input` (type, inputMode, min, required, defaultValue).
//
// CheckRow props
//   name           The checkbox's name; also the key of its error line.
//   label          The row's label.
//   text           The line next to the checkbox.
//   defaultChecked The checkbox's starting state.

import { FieldRow } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";

export function InputRow({
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
    <FieldRow name={name} label={label} htmlFor={id} help={help}>
      <Input id={id} name={name} {...input} />
    </FieldRow>
  );
}

export function CheckRow({
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
    <FieldRow name={name} label={label}>
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          className="size-5"
        />
        {text}
      </label>
    </FieldRow>
  );
}

// PositionActiveRows: the display-order and active rows of a catalog entry's form. A new entry
// (no `entry`) starts active.
//   idPrefix    The form's id prefix.
//   position    Label of the order row.
//   active      Label of the active row.
//   activeHelp  The line next to the active checkbox.
//   entry       The entry being changed, if any.
export function PositionActiveRows({
  idPrefix,
  position,
  active,
  activeHelp,
  entry,
}: {
  idPrefix: string;
  position: React.ReactNode;
  active: React.ReactNode;
  activeHelp: React.ReactNode;
  entry?: { position: number; isActive: boolean };
}) {
  return (
    <>
      <InputRow
        name="position"
        label={position}
        idPrefix={idPrefix}
        type="number"
        inputMode="numeric"
        defaultValue={entry?.position}
      />
      <CheckRow
        name="isActive"
        label={active}
        text={activeHelp}
        defaultChecked={entry ? entry.isActive : true}
      />
    </>
  );
}
