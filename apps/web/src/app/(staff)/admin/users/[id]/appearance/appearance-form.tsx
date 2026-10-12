import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { saveAppearance } from "./actions";

type Choice = { id: number; name: string };

function Choices({
  id,
  name,
  items,
  keep,
  off,
}: {
  id: string;
  name: string;
  items: Choice[];
  keep: string;
  off: string;
}) {
  return (
    <select id={id} name={name} defaultValue="" className={selectClass}>
      <option value="">{keep}</option>
      <option value="none">{off}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

// What a member wears: a frame, an accent, a name colour and a cover from the gallery, picked from
// the catalogs. The backend does not tell an administrator which entries the member wears now
// (only the frame and name colour as drawn), so each choice starts on "leave as it is".
export async function AppearanceForm({
  userId,
  catalogs,
  readOnly,
}: {
  userId: number;
  catalogs: {
    frames: Choice[];
    accents: Choice[];
    nameColours: Choice[];
    covers: Choice[];
  };
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.appearance");
  const rows = [
    ["frameId", "frame", catalogs.frames],
    ["accentId", "accent", catalogs.accents],
    ["nameColorId", "nameColour", catalogs.nameColours],
    ["coverPresetId", "cover", catalogs.covers],
  ] as const;
  return (
    <FormRows
      action={saveAppearance}
      heading={t("heading")}
      description={t("description")}
      disabled={readOnly}
    >
      <input type="hidden" name="id" value={userId} />
      {rows.map(([name, key, items]) => (
        <FieldRow
          key={name}
          name={name}
          label={t(key)}
          htmlFor={`appearance-${name}`}
          help={t(`${key}Help`)}
        >
          <Choices
            id={`appearance-${name}`}
            name={name}
            items={items}
            keep={t("keep")}
            off={t("takeOff")}
          />
        </FieldRow>
      ))}
      <FieldRow name="reason" label={t("reason")} htmlFor="appearance-reason">
        <Input id="appearance-reason" name="reason" maxLength={1000} />
      </FieldRow>
    </FormRows>
  );
}
