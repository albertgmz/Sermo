import type { Ctx } from "../../context";
import type { DomainEvent } from "../../events";
import { counted, listed } from "./build";
import type { Spec } from "./types";

/** A gift lands with its recipient, not with the buyer the consumers already follow. */
const recipient = (event: DomainEvent) =>
  event.type === "shop.purchased" ? [Number(event.payload.recipientId)] : [];
/** Using up a consumable changes whether its member still holds it. */
const user = (event: DomainEvent) =>
  event.type === "shop.item_used" ? [Number(event.payload.userId)] : [];
const onPurchase = {
  on: ["shop.purchased"],
  members: (_ctx: Ctx, event: DomainEvent) => recipient(event),
} as const;
const onPurchaseOrUse = {
  on: ["shop.purchased", "shop.item_used"],
  members: (_ctx: Ctx, event: DomainEvent) => [...recipient(event), ...user(event)],
} as const;

/** What the member holds, wears, bought and earned in the shop and the credit ledger. */
export const economySpecs: readonly Spec[] = [
  // Holds it now: an item in effect, or a consumable with units left (one seek per listed item).
  listed(
    "owns_item",
    "shopItems",
    {
      shape: "perId",
      sql:
        "SELECT i.user_id AS user_id, i.item_id AS id, 1 AS n FROM shop_inventory i INDEXED BY shop_inventory_user_item " +
        "WHERE i.user_id IN (SELECT value FROM json_each(?1)) AND i.item_id IN (SELECT value FROM json_each(?2)) " +
        "AND i.state IN ('active', 'unused') AND (i.expires_at IS NULL OR i.expires_at > ?4)",
    },
    {
      modes: ["one", "each"],
      cost: "cheap",
      refresh: onPurchaseOrUse,
    },
  ),
  // Owns it and shows it: the frame, name color or name icon the item gives is the one chosen.
  listed(
    "wears_item",
    "shopItems",
    {
      shape: "perId",
      sql:
        "SELECT u.id AS user_id, i.id AS id, 1 AS n FROM shop_items i, users u " +
        "WHERE i.id IN (SELECT value FROM json_each(?2)) AND u.id IN (SELECT value FROM json_each(?1)) " +
        "AND (u.name_icon_item_id = i.id " +
        "OR (json_extract(i.effect, '$.type') = 'frame' AND u.frame_id = json_extract(i.effect, '$.frameId')) " +
        "OR (json_extract(i.effect, '$.type') = 'nameColor' AND u.name_color_id = json_extract(i.effect, '$.colorId'))) " +
        "AND EXISTS (SELECT 1 FROM shop_inventory v INDEXED BY shop_inventory_user_item WHERE v.user_id = u.id AND v.item_id = i.id " +
        "AND v.state = 'active' AND (v.expires_at IS NULL OR v.expires_at > ?4))",
    },
    { modes: ["one", "each"], cost: "cheap", refresh: onPurchase },
  ),
  // Paid for anything in the category, for themselves or as a gift. One seek per item of the
  // category for a member who bought nothing in it: cheap while categories hold dozens of items.
  listed(
    "bought_in_category",
    "shopCategories",
    {
      shape: "perId",
      sql:
        "SELECT m.value AS user_id, c.value AS id, 1 AS n FROM json_each(?1) m, json_each(?2) c " +
        "WHERE EXISTS (SELECT 1 FROM shop_items i INDEXED BY shop_items_category WHERE i.category_id = c.value " +
        "AND EXISTS (SELECT 1 FROM shop_purchases p INDEXED BY shop_purchases_buyer_item WHERE p.buyer_id = m.value AND p.item_id = i.id))",
    },
    { modes: ["one", "each"], cost: "cheap" },
  ),
  // Units the member paid for that went to someone else.
  counted("gifted_items", {
    shape: "scalar",
    sql:
      "SELECT buyer_id AS user_id, NULL AS id, sum(quantity) AS n FROM shop_purchases INDEXED BY shop_purchases_buyer " +
      "WHERE buyer_id IN (SELECT value FROM json_each(?1)) AND recipient_id != buyer_id GROUP BY buyer_id",
  }),
  // Credits from credit rules and awards, net of what was taken back; adjustments and shop
  // purchases are not earnings.
  counted(
    "credits_earned",
    {
      shape: "scalar",
      sql:
        "SELECT user_id, NULL AS id, sum(amount) AS n FROM credit_transactions INDEXED BY credit_transactions_user " +
        "WHERE user_id IN (SELECT value FROM json_each(?1)) AND created_at >= ?3 " +
        "AND type IN ('event', 'event_reversal', 'award', 'award_revoked') GROUP BY user_id",
    },
    // Reads the member's whole ledger (see Needs: an index on `created_at`), and a member who earns
    // credits per reaction would read it again for each one: the sweep only, until it has one.
    { window: true, sweepOnly: true },
  ),
  listed(
    "credits_from_rule",
    "creditRules",
    {
      shape: "perId",
      sql:
        "SELECT a.user_id AS user_id, a.rule_id AS id, sum(a.amount) AS n FROM credit_rule_applications a INDEXED BY credit_rule_applications_limit " +
        "WHERE a.rule_id IN (SELECT value FROM json_each(?2)) AND a.user_id IN (SELECT value FROM json_each(?1)) " +
        "AND a.state = 'applied' AND a.created_at >= ?3 GROUP BY a.rule_id, a.user_id",
    },
    { modes: ["all", "one", "each"], value: true, window: true },
  ),
];
