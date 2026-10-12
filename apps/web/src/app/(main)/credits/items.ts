import {
  catalogImagesList,
  paletteColorsList,
  type shopItemsList,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { read } from "@/lib/sermo/client";

export type ShopItemData = z.output<
  typeof shopItemsList.output
>["items"][number];
export type CatalogImageData = z.output<
  typeof catalogImagesList.output
>["items"][number];
export type PaletteColorData = z.output<
  typeof paletteColorsList.output
>["items"][number];

// The catalog entries the effects of a set of items name, by id.
export type Catalogs = {
  frames: Map<number, CatalogImageData>;
  covers: Map<number, CatalogImageData>;
  colors: Map<number, PaletteColorData>;
};

// Asks only for the catalogs some item needs. An entry the administrators withdrew after it was
// sold is not listed: the item then shows without it.
export async function catalogsFor(
  items: readonly Pick<ShopItemData, "effect">[],
): Promise<Catalogs> {
  const uses = (type: ShopItemData["effect"]["type"]) =>
    items.some(({ effect }) => effect.type === type);
  const [frames, covers, colors] = await Promise.all([
    uses("frame")
      ? read(catalogImagesList, { kind: "frame" })
      : { items: [] as CatalogImageData[] },
    uses("threadCover")
      ? read(catalogImagesList, { kind: "thread_cover" })
      : { items: [] as CatalogImageData[] },
    uses("nameColor")
      ? read(paletteColorsList, { kind: "name" })
      : { items: [] as PaletteColorData[] },
  ]);
  const byId = <T extends { id: number }>(list: T[]) =>
    new Map(list.map((entry) => [entry.id, entry]));
  return {
    frames: byId(frames.items),
    covers: byId(covers.items),
    colors: byId(colors.items),
  };
}
