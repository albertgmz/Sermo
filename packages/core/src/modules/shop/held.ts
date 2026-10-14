import type { Ctx } from "../../context";
import { publishEvent } from "../../events";
import { statement } from "./data";

/**
 * What a member holds: an inventory row in state `active` (a non-consumable that has not run out)
 * or `unused` (a consumable with units left). One query per kind, on the member's inventory by
 * state (`shop_inventory_user_state`); a member's inventory is small.
 */
export const heldSql = {
  frame:
    "SELECT json_extract(it.effect, '$.frameId') AS id FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state IN ('active', 'unused') AND (inv.expires_at IS NULL OR inv.expires_at > ?2) AND json_extract(it.effect, '$.type') = 'frame'",
  nameColor:
    "SELECT json_extract(it.effect, '$.colorId') AS id FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state IN ('active', 'unused') AND (inv.expires_at IS NULL OR inv.expires_at > ?2) AND json_extract(it.effect, '$.type') = 'nameColor'",
  nameIcon:
    "SELECT it.id AS id, it.name AS name, json_extract(it.effect, '$.icon') AS icon, json_extract(it.effect, '$.position') AS position FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state IN ('active', 'unused') AND (inv.expires_at IS NULL OR inv.expires_at > ?2) AND json_extract(it.effect, '$.type') = 'nameIcon'",
  worn: "SELECT frame_id, name_color_id, name_icon_item_id FROM users WHERE id = ?1",
  clear:
    "UPDATE users SET frame_id = CASE WHEN ?2 = 1 THEN NULL ELSE frame_id END, name_color_id = CASE WHEN ?3 = 1 THEN NULL ELSE name_color_id END, name_icon_item_id = CASE WHEN ?4 = 1 THEN NULL ELSE name_icon_item_id END, content_updated_at = ?5 WHERE id = ?1",
};

function ids(ctx: Ctx, sql: string, userId: number): Set<number> {
  return new Set(
    statement<{ id: number }>(ctx, sql)
      .all(userId, ctx.now())
      .map((row) => row.id),
  );
}

/** The frames the member holds, by catalog id. */
export const heldFrameIds = (ctx: Ctx, userId: number) => ids(ctx, heldSql.frame, userId);
/** The name colours the member holds, by palette id. */
export const heldNameColorIds = (ctx: Ctx, userId: number) => ids(ctx, heldSql.nameColor, userId);

export interface HeldNameIcon {
  id: number;
  name: string;
  icon: string;
  position: "before" | "after";
}
/** The name icons the member holds, oldest item first. */
export const heldNameIcons = (ctx: Ctx, userId: number): HeldNameIcon[] =>
  statement<HeldNameIcon>(ctx, heldSql.nameIcon)
    .all(userId, ctx.now())
    .sort((a, b) => a.id - b.id);
/** The shop items whose name icon the member holds. */
export const heldNameIconItemIds = (ctx: Ctx, userId: number) => ids(ctx, heldSql.nameIcon, userId);

/**
 * Call in the transaction that moves an inventory row of `userId` out of the held states (the
 * expiry job, the last unit of a consumable, a rank replaced by `shop.upgrade`): the frame,
 * name colour or name icon the member wears comes off unless another row still holds it.
 */
export function releaseUnheldWear(ctx: Ctx, userId: number): void {
  const worn = statement<{
    frame_id: number | null;
    name_color_id: number | null;
    name_icon_item_id: number | null;
  }>(ctx, heldSql.worn).get(userId);
  if (
    !worn ||
    (worn.frame_id === null && worn.name_color_id === null && worn.name_icon_item_id === null)
  )
    return;
  const frame = worn.frame_id !== null && !heldFrameIds(ctx, userId).has(worn.frame_id);
  const color =
    worn.name_color_id !== null && !heldNameColorIds(ctx, userId).has(worn.name_color_id);
  const icon =
    worn.name_icon_item_id !== null &&
    !heldNameIconItemIds(ctx, userId).has(worn.name_icon_item_id);
  if (!frame && !color && !icon) return;
  statement(ctx, heldSql.clear).run(userId, Number(frame), Number(color), Number(icon), ctx.now());
  publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: userId });
}
