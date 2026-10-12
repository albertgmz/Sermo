import type * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { MemberAuthor, MemberCard } from "../../contracts/members";
import {
  can,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionValue,
  requestVersions,
} from "../../permissions";
import { levelFor, levelTitle } from "../../shared/levels";
import { iso } from "../../time";
import { catalogs } from "../appearance/store";
import { readSiteSettings } from "../settings";
import { publicPicture, resolvedFileUrl } from "../storage/url";

type Card = z.infer<typeof MemberCard>;
type Author = z.infer<typeof MemberAuthor>;
type Catalogs = ReturnType<typeof catalogs>;

export const MEMBER_ROWS_SQL =
  "SELECT u.id, u.username, u.group_id, u.avatar_file_id, u.frame_id, u.name_color_id, u.custom_title, u.award_xp, " +
  `u.cover_file_id, u.cover_preset_id, u.reaction_score, u.signature_html, c.group_ids, ${PRINCIPAL_COLUMNS} ` +
  "FROM users u LEFT JOIN permission_combinations c ON c.id = u.permission_combination_id " +
  "WHERE u.id IN (SELECT value FROM json_each(?1))";
export const MEMBER_GROUPS_SQL =
  "SELECT id, title, rank, user_title, badge, name_color_id FROM groups WHERE id IN (SELECT value FROM json_each(?1))";
export const AVATAR_VARIANTS_SQL =
  "SELECT parent_file_id, id FROM files WHERE variant = 'square_128' AND deleted_at IS NULL AND parent_file_id IN (SELECT value FROM json_each(?1))";
export const HELD_AWARDS_SQL =
  "SELECT t.user_id, a.id, a.name, a.icon, a.tier, a.xp, a.image_file_id FROM member_award_totals t JOIN awards a ON a.id = t.award_id " +
  "WHERE t.user_id IN (SELECT value FROM json_each(?1)) AND t.count > 0";

export interface MemberRow extends PrincipalRow {
  id: number;
  username: string;
  group_id: number;
  avatar_file_id: number | null;
  frame_id: number | null;
  name_color_id: number | null;
  custom_title: string | null;
  award_xp: number;
  cover_file_id: number | null;
  cover_preset_id: number | null;
  reaction_score: number;
  signature_html: string | null;
  group_ids: string | null;
}
interface GroupRow {
  id: number;
  title: string;
  rank: number;
  user_title: string;
  badge: string;
  name_color_id: number | null;
}
interface HeldAward {
  user_id: number;
  id: number;
  name: string;
  icon: string;
  tier: "bronze" | "silver" | "gold" | "legendary";
  xp: number;
  image_file_id: number | null;
}

const TIER_ORDER = { legendary: 3, gold: 2, silver: 1, bronze: 0 } as const;

/** The groups a member holds: primary, by hand, by promotion or bought (their stored combination). */
function groupIdsOf(row: MemberRow): number[] {
  const ids = (row.group_ids ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? ids : [row.group_id];
}

/** The cover a profile shows: the chosen gallery cover, else the uploaded one, else null. */
function coverOf(ctx: Ctx, catalog: Catalogs, row: MemberRow) {
  const preset =
    row.cover_preset_id === null ? null : catalog.imageById.get(row.cover_preset_id)?.image;
  return preset ?? publicPicture(ctx, row.cover_file_id);
}

interface LoadedMembers {
  rows: Map<number, MemberRow>;
  cards: Map<number, Card>;
  /** The member's own permissions, not the viewer's. */
  mayShowSignature: Map<number, boolean>;
  awardSlots: Map<number, number>;
  catalog: Catalogs;
  levelStep: number;
}

/**
 * The cards of a page of members in a fixed number of queries: the site settings, the member
 * rows (with their group combination), their groups, their avatars' small renditions and the
 * catalog cache's version. `viewer` only supplies the cache versions the members' own
 * permissions are resolved with; nothing here depends on who is looking.
 */
function loadMembers(ctx: Ctx, viewer: Actor, ids: Iterable<number>): LoadedMembers {
  const unique = [...new Set(ids)];
  const settings = readSiteSettings(ctx);
  const catalog = catalogs(ctx);
  const rows = new Map<number, MemberRow>();
  const cards = new Map<number, Card>();
  const mayShowSignature = new Map<number, boolean>();
  const awardSlots = new Map<number, number>();
  const result: LoadedMembers = {
    rows,
    cards,
    mayShowSignature,
    awardSlots,
    catalog,
    levelStep: settings.levelStep,
  };
  if (unique.length === 0) return result;
  for (const row of prepared(ctx, "members.rows", () =>
    ctx.sqlite.prepare<MemberRow, [string]>(MEMBER_ROWS_SQL),
  ).all(JSON.stringify(unique)))
    rows.set(row.id, row);
  if (rows.size === 0) return result;

  const groupIds = new Set<number>();
  const avatarIds = new Set<number>();
  for (const row of rows.values()) {
    for (const id of groupIdsOf(row)) groupIds.add(id);
    if (row.avatar_file_id !== null) avatarIds.add(row.avatar_file_id);
  }
  const groups = new Map(
    prepared(ctx, "members.groups", () => ctx.sqlite.prepare<GroupRow, [string]>(MEMBER_GROUPS_SQL))
      .all(JSON.stringify([...groupIds]))
      .map((group) => [group.id, group] as const),
  );
  const smallAvatar = new Map<number, number>();
  if (avatarIds.size > 0)
    for (const variant of prepared(ctx, "members.avatarVariants", () =>
      ctx.sqlite.prepare<{ parent_file_id: number; id: number }, [string]>(AVATAR_VARIANTS_SQL),
    ).all(JSON.stringify([...avatarIds])))
      smallAvatar.set(variant.parent_file_id, variant.id);

  const versions = requestVersions(ctx, viewer);
  const colorHex = (id: number | null) =>
    id === null ? null : (catalog.colorById.get(id)?.color ?? null);
  for (const row of rows.values()) {
    const member = memberActor(row.id, row.group_id, row, versions);
    const held = groupIdsOf(row)
      .map((id) => groups.get(id))
      .filter((group): group is GroupRow => group !== undefined)
      .sort((a, b) => b.rank - a.rank || a.id - b.id);
    const level = levelFor(row.award_xp, settings.levelStep).level;
    const custom = row.custom_title?.trim() ?? "";
    const groupTitle = held[0]?.user_title ?? "";
    const title =
      custom !== "" && can(ctx, member, "profile.customTitle")
        ? custom
        : groupTitle !== ""
          ? groupTitle
          : levelTitle(level, settings.levelTitles);
    const frame = row.frame_id === null ? undefined : catalog.imageById.get(row.frame_id);
    mayShowSignature.set(row.id, can(ctx, member, "profile.signature"));
    awardSlots.set(row.id, permissionValue(ctx, member, "profile.awardSlots"));
    cards.set(row.id, {
      id: row.id,
      username: row.username,
      avatar:
        row.avatar_file_id === null
          ? null
          : {
              url: resolvedFileUrl(ctx, row.avatar_file_id, true),
              smallUrl: resolvedFileUrl(
                ctx,
                smallAvatar.get(row.avatar_file_id) ?? row.avatar_file_id,
                true,
              ),
            },
      frame:
        frame?.image && frame.placement
          ? { url: frame.image.url, placement: frame.placement }
          : null,
      nameColor:
        colorHex(row.name_color_id) ??
        held.map((group) => colorHex(group.name_color_id)).find((hex) => hex !== null) ??
        null,
      title,
      badges: held
        .filter((group) => group.badge !== "")
        .map((group) => ({
          label: group.title,
          color: colorHex(group.name_color_id),
          style: group.badge,
        })),
      level,
    });
  }
  return result;
}

/** Cards for a page of ids; ids that do not exist are absent. */
export function loadMemberCards(ctx: Ctx, viewer: Actor, ids: Iterable<number>) {
  return loadMembers(ctx, viewer, ids).cards;
}

/**
 * Authors for a page of ids: the cards plus cover, counters, level bounds, shown awards and
 * signature. One query more than the cards for the awards held (none when `awards` is false).
 */
export function loadMemberAuthors(
  ctx: Ctx,
  viewer: Actor,
  ids: Iterable<number>,
  options: { awards?: boolean } = {},
): Map<number, Author> {
  const loaded = loadMembers(ctx, viewer, ids);
  const held = new Map<number, HeldAward[]>();
  if (loaded.rows.size > 0 && options.awards !== false)
    for (const award of prepared(ctx, "members.heldAwards", () =>
      ctx.sqlite.prepare<HeldAward, [string]>(HELD_AWARDS_SQL),
    ).all(JSON.stringify([...loaded.rows.keys()]))) {
      const list = held.get(award.user_id) ?? [];
      list.push(award);
      held.set(award.user_id, list);
    }
  const authors = new Map<number, Author>();
  for (const [id, row] of loaded.rows) {
    const level = levelFor(row.award_xp, loaded.levelStep);
    const slots = loaded.awardSlots.get(id) ?? 0;
    const shown = (held.get(id) ?? []).sort(
      (a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier] || b.xp - a.xp || a.id - b.id,
    );
    authors.set(id, {
      card: loaded.cards.get(id)!,
      cover: coverOf(ctx, loaded.catalog, row),
      createdAt: iso(row.created_at),
      postCount: row.post_count,
      reactionScore: row.reaction_score,
      awardXp: row.award_xp,
      currentLevelXp: level.currentLevelXp,
      nextLevelXp: level.nextLevelXp,
      awards: (slots < 0 ? shown : shown.slice(0, slots)).map((award) => ({
        id: award.id,
        name: award.name,
        icon: award.icon,
        image: publicPicture(ctx, award.image_file_id),
        tier: award.tier,
      })),
      signatureHtml: loaded.mayShowSignature.get(id) ? row.signature_html : null,
    });
  }
  return authors;
}
