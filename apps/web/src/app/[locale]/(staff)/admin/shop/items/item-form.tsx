import { ShopEffect, type shopItemsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { Advanced, Field, FieldGroup } from "@/components/staff/edit-form";
import { PictureField } from "@/components/staff/picture-field";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
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
    case "nameIcon":
      return { type: "nameIcon", icon: effect.icon, position: effect.position };
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

// A duration in the largest unit it divides into evenly; one that is not a whole number of
// minutes is shown exactly, in seconds.
export function durationOf(seconds: number | null) {
  if (seconds === null) return null;
  if (seconds % 86_400 === 0)
    return { amount: seconds / 86_400, unit: "days" } as const;
  if (seconds % 3_600 === 0)
    return { amount: seconds / 3_600, unit: "hours" } as const;
  if (seconds % 60 === 0)
    return { amount: seconds / 60, unit: "minutes" } as const;
  return { amount: seconds, unit: "seconds" } as const;
}

// The help and error lines of a `Field`, by its control's id.
const describedBy = (id: string) => `${id}-help ${id}-error`;

// The fields of an item, for a new one (no `item`) or a change, inside the page's `EditForm`. The
// catalog pictures are drawn here, on the server, through the same LITE gate as on the public site.
export async function ItemFormFields({
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
    <>
      {item && <input type="hidden" name="id" value={item.id} />}
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field
          name="categoryId"
          label={t("category")}
          htmlFor={`${key}-category`}
        >
          <select
            id={`${key}-category`}
            name="categoryId"
            required
            defaultValue={item?.categoryId ?? categoryId}
            aria-describedby={`${key}-category-error`}
            className={selectClass}
          >
            {lookups.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.isActive ? "" : ` (${t("inactive")})`}
              </option>
            ))}
          </select>
        </Field>
        <Field name="name" label={t("name")} htmlFor={`${key}-name`}>
          <Input
            id={`${key}-name`}
            name="name"
            required
            defaultValue={item?.name}
            aria-describedby={`${key}-name-error`}
          />
        </Field>
        <Field
          name="description"
          label={t("description")}
          htmlFor={`${key}-description`}
        >
          <Input
            id={`${key}-description`}
            name="description"
            defaultValue={item?.description}
            aria-describedby={`${key}-description-error`}
          />
        </Field>
        <Field
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
            aria-describedby={describedBy(`${key}-price`)}
            className="w-32"
          />
        </Field>
        <Field
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
        </Field>
        <Field
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
            aria-describedby={describedBy(`${key}-stock`)}
            className="w-32"
          />
        </Field>
        <Field name="isGiftable" label={t("giftable")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isGiftable"
              defaultChecked={item?.isGiftable ?? false}
              className="size-5"
            />
            {t("giftableHelp")}
          </label>
        </Field>
        <Field name="isActive" label={t("active")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={item ? item.isActive : true}
              className="size-5"
            />
            {t("activeHelp")}
          </label>
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("effectGroup")} description={t("effectGroupHelp")}>
        <ItemEffect
          idPrefix={key}
          types={EFFECT_TYPES}
          initial={effect ? initialOf(effect) : null}
          choices={{
            frames: pictured(
              lookups.frames,
              effect?.type === "frame" ? effect.frameId : undefined,
              (url) => (
                <Art
                  src={url}
                  category="frames"
                  className="size-16 rounded-lg"
                />
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
      </FieldGroup>
      <Advanced label={t("orderAccess")} fields={["position", "rule"]}>
        <Field
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
            aria-describedby={describedBy(`${key}-position`)}
            className="w-32"
          />
        </Field>
        <RuleField place="shopItem" owner={item?.id} rule={item?.rule} />
      </Advanced>
    </>
  );
}
