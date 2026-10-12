import { paletteColorsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { read } from "@/lib/sermo/client";

// The name colours of the palette as swatches to pick one from, plus "none". `current` is the id
// the record has now: when the palette no longer offers it to the viewer, it stays as an option so
// a save does not drop it unseen.
export async function ColourPicker({
  name = "nameColorId",
  current,
}: {
  name?: string;
  current: number | null;
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminGroups.colourPicker"),
    read(paletteColorsList, { kind: "name" }),
  ]);
  const hidden = current !== null && !items.some((c) => c.id === current);
  const option =
    "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm peer-checked:border-ring peer-checked:bg-muted peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50";
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{t("legend")}</legend>
      <label className="relative">
        <input
          type="radio"
          name={name}
          value=""
          defaultChecked={current === null}
          className="peer sr-only"
        />
        <span className={option}>{t("none")}</span>
      </label>
      {hidden && (
        <label className="relative">
          <input
            type="radio"
            name={name}
            value={current}
            defaultChecked
            className="peer sr-only"
          />
          <span className={option}>{t("kept", { id: current })}</span>
        </label>
      )}
      {items.map((colour) => (
        <label key={colour.id} className="relative">
          <input
            type="radio"
            name={name}
            value={colour.id}
            defaultChecked={colour.id === current}
            className="peer sr-only"
          />
          <span className={option}>
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full border"
              style={{ backgroundColor: colour.color }}
            />
            <span className={colour.isActive ? undefined : "opacity-60"}>
              {colour.name}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
