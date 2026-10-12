import { ShopEffect, type shopItemsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { PictureField } from "@/components/staff/picture-field";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { saveItem } from "./actions";
import { type EffectType, type Initial, ItemEffect } from "./item-effect";
import type { Lookups } from "./lookups";

export type Item = z.output<typeof shopItemsGet.output>;

// The effect types the contract knows, in its own order.
export const EFFECT_TYPES: readonly EffectType[] = ShopEffect.options.map(
  (option) => option.shape.type.value,
);

function initialOf(effect: Item["effect"]): Initial {
  switch (effect.type) {
    case "frame":
      return { type: "frame", frameId: effect.frameId };
    case "nameColor":
      return { type: "nameColor", colorId: effect.colorId };
    case "threadCover":
      return { type: "threadCover", coverId: effect.coverId };
    case "group":
      return { type: "group", groupId: effect.groupId };
    case "permission":
      return {
        type: "permission",
        permission: effect.permission,
        value: effect.value,
      };
    case "highlight":
      return { type: "highlight", days: effect.days };
    default:
      return { type: effect.type };
  }
}

// A duration in the largest unit it divides into evenly.
function durationOf(seconds: number | null) {
  if (seconds === null) return null;
  if (seconds % 86_400 === 0)
    return { amount: seconds / 86_400, unit: "days" } as const;
  if (seconds % 3_600 === 0)
    return { amount: seconds / 3_600, unit: "hours" } as const;
  return { amount: Math.round(seconds / 60), unit: "minutes" } as const;
}

// The form of an item, for a new one (no `item`) or a change. The catalog pictures are drawn
// here, on the server, through the same LITE gate as on the public site.
export async function ItemForm({
  item,
  lookups,
  categoryId,
}: {
  item?: Item;
  lookups: Lookups;
  categoryId?: number;
}) {
  const t = await getTranslations("adminEconomy.items.form");
  const key = `item-${item?.id ?? "new"}`;
  const pictured = (
    entries: Lookups["frames"],
    chosen: number | undefined,
    draw: (url: string) => React.ReactNode,
  ) =>
    entries
      .filter((entry) => entry.image && (entry.isActive || entry.id === chosen))
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        picture: draw(entry.image?.url ?? ""),
      }));
  const effect = item?.effect;
  return (
    <FormRows
      action={saveItem}
      id={item ? undefined : "new"}
      heading={item ? t("headingEdit") : t("headingNew")}
      description={item ? undefined : t("descriptionNew")}
      submit={item ? undefined : t("create")}
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <FieldRow
        name="categoryId"
        label={t("category")}
        htmlFor={`${key}-category`}
      >
        <select
          id={`${key}-category`}
          name="categoryId"
          required
          defaultValue={item?.categoryId ?? categoryId}
          className={selectClass}
        >
          {lookups.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.isActive ? "" : ` (${t("inactive")})`}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow name="name" label={t("name")} htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          name="name"
          required
          defaultValue={item?.name}
        />
      </FieldRow>
      <FieldRow
        name="description"
        label={t("description")}
        htmlFor={`${key}-description`}
      >
        <Input
          id={`${key}-description`}
          name="description"
          defaultValue={item?.description}
        />
      </FieldRow>
      <FieldRow
        name="price"
        label={t("price")}
        htmlFor={`${key}-price`}
        help={t("priceHelp")}
      >
        <Input
          id={`${key}-price`}
          name="price"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={item?.price}
        />
      </FieldRow>
      <FieldRow
        name="fileId"
        label={t("picture")}
        htmlFor={`${key}-file`}
        help={t("pictureHelp")}
      >
        <PictureField
          purpose="shop_image"
          name="fileId"
          id={`${key}-file`}
          removable
          current={
            item?.image ? (
              <Art
                src={item.image.url}
                category="shop"
                className="size-16 rounded-lg"
              />
            ) : undefined
          }
        />
      </FieldRow>
      <ItemEffect
        idPrefix={key}
        types={EFFECT_TYPES}
        initial={effect ? initialOf(effect) : null}
        choices={{
          frames: pictured(
            lookups.frames,
            effect?.type === "frame" ? effect.frameId : undefined,
            (url) => (
              <Art src={url} category="frames" className="size-16 rounded-lg" />
            ),
          ),
          covers: pictured(
            lookups.covers,
            effect?.type === "threadCover" ? effect.coverId : undefined,
            (url) => (
              <Art
                src={url}
                category="threadCovers"
                className="h-16 w-full rounded-lg"
              />
            ),
          ),
          colours: lookups.colours
            .filter(
              (entry) =>
                entry.isActive ||
                (effect?.type === "nameColor" && effect.colorId === entry.id),
            )
            .map(({ id, name, color }) => ({ id, name, color })),
          groups:
            lookups.groups?.map(({ id, title }) => ({ id, title })) ?? null,
          permissions:
            lookups.permissions?.map((definition) => ({
              id: definition.id,
              title: definition.title,
              type: definition.type,
              unit: definition.unit,
            })) ?? null,
        }}
        consumable={item?.isConsumable ?? false}
        duration={durationOf(item?.durationSeconds ?? null)}
      />
      <FieldRow
        name="stock"
        label={t("stock")}
        htmlFor={`${key}-stock`}
        help={t("stockHelp")}
      >
        <Input
          id={`${key}-stock`}
          name="stock"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={item?.stock ?? undefined}
        />
      </FieldRow>
      <FieldRow name="isGiftable" label={t("giftable")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isGiftable"
            defaultChecked={item?.isGiftable ?? false}
            className="size-5"
          />
          {t("giftableHelp")}
        </label>
      </FieldRow>
      <FieldRow
        name="position"
        label={t("position")}
        htmlFor={`${key}-position`}
        help={t("positionHelp")}
      >
        <Input
          id={`${key}-position`}
          name="position"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={item?.position ?? 0}
        />
      </FieldRow>
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={item ? item.isActive : true}
            className="size-5"
          />
          {t("activeHelp")}
        </label>
      </FieldRow>
    </FormRows>
  );
}
