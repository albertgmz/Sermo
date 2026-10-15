import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Actor,
  type Ctx,
  contracts,
  type createStorage,
  execute,
  getOperation,
  type schema,
} from "@sermo/core";
import awardData from "./data/awards.json";
import covers from "./data/covers.json";
import forums from "./data/forums.json";
import frames from "./data/frames.json";
import palettes from "./data/palettes.json";
import settings from "./data/settings.json";
import shop from "./data/shop.json";

type Effect =
  | { type: "frame" | "threadCover"; name: string }
  | { type: "nameColor"; color: string }
  | { type: "nameIcon"; icon: string; position: "before" | "after" }
  | { type: "group"; group: string }
  | { type: "highlight"; days: number }
  | { type: "permission"; permission: string; value?: number }
  | { type: "bump" | "usernameChange" };
interface ItemData {
  category: string;
  name: string;
  description: string;
  price: number;
  consumable: boolean;
  image: string | null;
  effect: Effect;
}
interface AwardData {
  name: string;
  description: string;
  icon: string;
  tier: string;
  xp: number;
  image: string;
  criteria?: { criterion: string; value: number }[];
  rankItem?: string;
  manual?: string;
}
const shopItems = shop.items as ItemData[];
const awards = awardData as AwardData[];

/**
 * sharp is a dependency of core, which is where it is resolved from; the little of its interface
 * used here is typed locally.
 */
type Sharp = (
  input: Buffer,
  options?: { density: number },
) => {
  metadata(): Promise<{ width?: number; height?: number }>;
  resize(options: { width: number; height: number; fit: "inside" }): {
    png(): { toBuffer(): Promise<Buffer> };
  };
};
const sharp = createRequire(
  fileURLToPath(new URL("../../packages/core/package.json", import.meta.url)),
)("sharp") as Sharp;

/** Thrown by a hook to stop the whole run at once, as a crash would. */
export class StarterAbort extends Error {}

export type Outcome = "created" | "exists" | "skipped" | "failed";

export interface StarterLine {
  outcome: Outcome;
  kind: string;
  label: string;
  note?: string;
}

export interface StarterOptions {
  ctx: Ctx;
  storage: ReturnType<typeof createStorage>;
  /** An administrator: every call goes through core's operations as this actor. */
  actor: Actor;
  /** The folder holding `assets/` and `pages/`. */
  root: string;
  /** Reads one file of the starter folder. */
  readFile?: (path: string) => Promise<Uint8Array>;
  report?: (line: StarterLine) => void;
  /** Called before every operation and upload (n counts from 1); may throw StarterAbort. */
  beforeOperation?: (n: number, name: string) => void;
}

type Row = { id: number };
type Existing = Row & { name: string; image: unknown };

const RASTER_SIZE = 512;
const mimeOf = (file: string) => (file.endsWith(".png") ? "image/png" : "image/jpeg");

/** The lower-case key an entry is matched by. */
const key = (value: string) => value.trim().toLowerCase();

export async function loadStarter(options: StarterOptions): Promise<StarterLine[]> {
  const { ctx, storage, actor, root } = options;
  const readFile =
    options.readFile ?? (async (path) => new Uint8Array(await Bun.file(path).arrayBuffer()));
  const lines: StarterLine[] = [];
  let operations = 0;

  const emit = (line: StarterLine) => {
    lines.push(line);
    options.report?.(line);
  };
  const count = (name: string) => {
    operations += 1;
    options.beforeOperation?.(operations, name);
  };
  const call = async <T>(name: string, input: unknown): Promise<T> => {
    count(name);
    return (await execute(ctx, getOperation(name), actor, input)) as T;
  };
  /** One thing to load: `work` says whether it created it, found it, or why it left it. */
  const step = async (
    kind: string,
    label: string,
    work: () => Promise<"created" | "exists" | { skipped: string }>,
  ) => {
    try {
      const result = await work();
      if (typeof result === "string") emit({ outcome: result, kind, label });
      else emit({ outcome: "skipped", kind, label, note: result.skipped });
    } catch (error) {
      if (error instanceof StarterAbort) throw error;
      emit({
        outcome: "failed",
        kind,
        label,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** A listing the later steps match against; undefined (and a failed line) when it cannot be read. */
  const read = async <T>(kind: string, name: string, input: unknown): Promise<T | undefined> => {
    try {
      return await call<T>(name, input);
    } catch (error) {
      if (error instanceof StarterAbort) throw error;
      emit({
        outcome: "failed",
        kind,
        label: name,
        note: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };
  const unread = (what: string) => new Error(`${what} could not be read`);

  const bytesOf = (path: string) => readFile(join(root, "assets", path));
  const uploadBytes = async (bytes: Uint8Array, mime: string, purpose: string) => {
    count(`upload:${purpose}`);
    const file = await storage.upload(
      actor,
      new Blob([bytes as BlobPart]).stream() as ReadableStream<Uint8Array>,
      mime,
      purpose as (typeof schema.FILE_PURPOSES)[number],
    );
    return file.id;
  };
  const uploadFile = async (path: string, purpose: string) =>
    uploadBytes(await bytesOf(path), mimeOf(path), purpose);
  /** Uploads are raster only: a vector picture is drawn once at a fixed size. */
  const uploadVector = async (path: string, purpose: string) => {
    const source = Buffer.from(await bytesOf(path));
    const { width = RASTER_SIZE, height = RASTER_SIZE } = await sharp(source).metadata();
    const density = Math.max(72, Math.ceil((72 * RASTER_SIZE) / Math.max(width, height)));
    const png = await sharp(source, { density })
      .resize({ width: RASTER_SIZE, height: RASTER_SIZE, fit: "inside" })
      .png()
      .toBuffer();
    return uploadBytes(png, "image/png", purpose);
  };

  // Palettes -------------------------------------------------------------------------------
  const colors: Record<string, Map<string, number>> = {};
  for (const kind of ["accent", "name", "prefix"] as const) {
    const found = new Map<string, number>();
    colors[kind] = found;
    const listed = await read<{ items: { id: number; color: string }[] }>(
      `${kind} colour`,
      "paletteColors.list",
      { kind },
    );
    for (const item of listed?.items ?? []) found.set(item.color.toLowerCase(), item.id);
    for (const [position, entry] of palettes[kind].entries()) {
      const label = `${entry.name} ${entry.color}`;
      await step(`${kind} colour`, label, async () => {
        if (!listed) throw unread("the catalog");
        if (found.has(entry.color)) return "exists";
        const made = await call<Row>("paletteColors.create", {
          kind,
          name: entry.name,
          color: entry.color,
          ...("foreground" in entry ? { foreground: entry.foreground } : {}),
          position,
        });
        found.set(entry.color, made.id);
        return "created";
      });
    }
  }

  // Picture catalogs -----------------------------------------------------------------------
  const catalogs: Record<string, Map<string, Existing>> = {};
  const loadCatalog = async (
    kind: "frame" | "profile_cover" | "thread_cover",
    purpose: string,
    folder: string,
    entries: { file: string; name: string; placement?: unknown }[],
  ) => {
    const found = new Map<string, Existing>();
    catalogs[kind] = found;
    const listed = await read<{ items: Existing[] }>(`${kind} image`, "catalogImages.list", {
      kind,
    });
    for (const item of listed?.items ?? []) found.set(key(item.name), item);
    for (const [position, entry] of entries.entries()) {
      await step(`${kind} image`, entry.name, async () => {
        if (!listed) throw unread("the catalog");
        const placement = entry.placement ? { placement: entry.placement } : {};
        const present = found.get(key(entry.name));
        if (present?.image) return "exists";
        const fileId = await uploadFile(`${folder}/${entry.file}`, purpose);
        const made = present
          ? await call<Existing>("catalogImages.update", {
              imageId: present.id,
              fileId,
              ...placement,
            })
          : await call<Existing>("catalogImages.create", {
              kind,
              name: entry.name,
              fileId,
              position,
              ...placement,
            });
        found.set(key(entry.name), made);
        return "created";
      });
    }
  };
  await loadCatalog("frame", "frame", "frames", frames);
  await loadCatalog("profile_cover", "cover_preset", "covers", covers.profile);
  await loadCatalog("thread_cover", "thread_cover", "thread-covers", covers.thread);

  // Forum tabs, categories and forums ------------------------------------------------------
  const tabs = new Map<string, number>();
  const tabList = await read<{ items: { id: number; title: string }[] }>(
    "forum tab",
    "forumTabs.list",
    {},
  );
  for (const tab of tabList?.items ?? []) tabs.set(key(tab.title), tab.id);
  for (const [position, title] of forums.tabs.entries()) {
    await step("forum tab", title, async () => {
      if (!tabList) throw unread("the tabs");
      if (tabs.has(key(title))) return "exists";
      tabs.set(key(title), (await call<Row>("forumTabs.create", { title, position })).id);
      return "created";
    });
  }

  type NodeRow = Row & {
    parentId: number | null;
    title: string;
    icon: unknown;
    cover: unknown;
  };
  const nodes = new Map<string, NodeRow>();
  const nodeKey = (parentId: number | null, title: string) => `${parentId ?? 0}/${key(title)}`;
  const nodeList = await read<{ items: NodeRow[] }>("forum", "nodes.list", {});
  for (const node of nodeList?.items ?? []) nodes.set(nodeKey(node.parentId, node.title), node);
  const ensureNode = async (
    kind: "category" | "forum",
    parentId: number | null,
    title: string,
    position: number,
    extra: { description?: string; tabId?: number },
  ): Promise<NodeRow> => {
    if (!nodeList) throw unread("the forum list");
    const present = nodes.get(nodeKey(parentId, title));
    if (present) return present;
    const made = await call<NodeRow>("nodes.create", {
      parentId,
      type: kind,
      title,
      position,
      ...extra,
    });
    nodes.set(nodeKey(parentId, title), made);
    return made;
  };
  const nodePictures = async (node: NodeRow, image: string) => {
    let changed = false;
    if (!node.icon) {
      const fileId = await uploadFile(`forums/${image}`, "node_icon");
      await call("images.setNodeIcon", { nodeId: node.id, fileId });
      node.icon = true;
      changed = true;
    }
    if (!node.cover) {
      const fileId = await uploadFile(`forums/${image}`, "node_cover");
      await call("images.setNodeCover", { nodeId: node.id, fileId });
      node.cover = true;
      changed = true;
    }
    return changed;
  };
  for (const [index, category] of forums.categories.entries()) {
    let parent: NodeRow | undefined;
    await step("category", category.title, async () => {
      const known = nodes.has(nodeKey(null, category.title));
      const tabId = tabs.get(key(category.tab));
      if (!known && !tabId) throw new Error(`its tab "${category.tab}" is missing`);
      parent = await ensureNode("category", null, category.title, index, {
        ...(tabId ? { tabId } : {}),
      });
      return known ? "exists" : "created";
    });
    const category_ = parent;
    for (const [at, forum] of category.forums.entries()) {
      let node: NodeRow | undefined;
      await step("forum", forum.title, async () => {
        if (!category_) throw new Error(`its category "${category.title}" is missing`);
        const known = nodes.has(nodeKey(category_.id, forum.title));
        node = await ensureNode("forum", category_.id, forum.title, at, {
          description: forum.description,
        });
        const pictured = await nodePictures(node, forum.image);
        return known && !pictured ? "exists" : "created";
      });
      const forumNode = node;
      for (const [sub, title] of forum.subforums.entries()) {
        await step("subforum", `${forum.title} / ${title}`, async () => {
          if (!forumNode) throw new Error(`its forum "${forum.title}" is missing`);
          const known = nodes.has(nodeKey(forumNode.id, title));
          await ensureNode("forum", forumNode.id, title, sub, {});
          return known ? "exists" : "created";
        });
      }
    }
  }

  // Thread prefixes ------------------------------------------------------------------------
  const prefixes = new Set<string>();
  const prefixList = await read<{ items: { label: string }[] }>(
    "thread prefix",
    "threadPrefixes.list",
    {},
  );
  for (const prefix of prefixList?.items ?? []) prefixes.add(key(prefix.label));
  for (const [position, prefix] of forums.prefixes.entries()) {
    await step("thread prefix", prefix.label, async () => {
      if (!prefixList) throw unread("the prefixes");
      if (prefixes.has(key(prefix.label))) return "exists";
      const colorId = colors.prefix!.get(prefix.color);
      if (!colorId) throw new Error(`the prefix colour ${prefix.color} is missing`);
      await call("threadPrefixes.create", {
        label: prefix.label,
        colorId,
        icon: prefix.icon,
        position,
      });
      prefixes.add(key(prefix.label));
      return "created";
    });
  }

  // Groups of the paid ranks ---------------------------------------------------------------
  const groups = new Map<string, number>();
  const groupList = await read<{ items: { id: number; title: string }[] }>(
    "group",
    "groups.list",
    {},
  );
  for (const group of groupList?.items ?? []) groups.set(key(group.title), group.id);
  for (const rank of shop.rankGroups) {
    await step("group", rank.title, async () => {
      if (!groupList) throw unread("the groups");
      let id = groups.get(key(rank.title));
      const known = id !== undefined;
      if (id === undefined) {
        const nameColorId = colors.name!.get(rank.nameColor);
        if (!nameColorId) throw new Error(`the name colour ${rank.nameColor} is missing`);
        id = (
          await call<Row>("groups.create", {
            title: rank.title,
            description: rank.description,
            rank: rank.rank,
            badge: rank.badge,
            nameColorId,
          })
        ).id;
        groups.set(key(rank.title), id);
      }
      // A group starts with no entries; one that has some is left to the administrator.
      const held = await call<{ entries: unknown[] }>("permissions.list", { groupId: id });
      if (held.entries.length > 0) return known ? "exists" : "created";
      await call("permissions.set", {
        groupId: id,
        entries: rank.permissions.map((entry) => ({
          permission: entry.permission,
          value: "value" in entry ? entry.value : "allow",
        })),
      });
      return "created";
    });
  }

  // Shop -----------------------------------------------------------------------------------
  const categories = new Map<string, number>();
  const categoryList = await read<{ items: { id: number; name: string }[] }>(
    "shop category",
    "shopCategories.list",
    {},
  );
  for (const category of categoryList?.items ?? []) categories.set(key(category.name), category.id);
  for (const [position, category] of shop.categories.entries()) {
    await step("shop category", category.name, async () => {
      if (!categoryList) throw unread("the categories");
      if (categories.has(key(category.name))) return "exists";
      const made = await call<Row>("shopCategories.create", { ...category, position });
      categories.set(key(category.name), made.id);
      return "created";
    });
  }
  type ItemRow = Row & { name: string; image: unknown };
  const itemsOf = new Map<number, Map<string, ItemRow>>();
  const listItems = async (categoryId: number) => {
    const cached = itemsOf.get(categoryId);
    if (cached) return cached;
    const found = new Map<string, ItemRow>();
    let cursor: string | undefined;
    do {
      const page = await call<{ items: ItemRow[]; nextCursor: string | null }>("shopItems.list", {
        categoryId,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items) found.set(key(item.name), item);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    itemsOf.set(categoryId, found);
    return found;
  };
  const effectOf = (effect: Effect) => {
    switch (effect.type) {
      case "frame": {
        const frame = catalogs.frame!.get(key(effect.name));
        if (!frame?.image) throw new Error(`the frame "${effect.name}" is missing`);
        return { type: "frame", frameId: frame.id };
      }
      case "nameColor": {
        const colorId = colors.name!.get(effect.color);
        if (!colorId) throw new Error(`the name colour ${effect.color} is missing`);
        return { type: "nameColor", colorId };
      }
      case "threadCover": {
        const cover = catalogs.thread_cover!.get(key(effect.name));
        if (!cover?.image) throw new Error(`the thread cover "${effect.name}" is missing`);
        return { type: "threadCover", coverId: cover.id };
      }
      case "group": {
        const groupId = groups.get(key(effect.group));
        if (!groupId) throw new Error(`the group "${effect.group}" is missing`);
        return { type: "group", groupId };
      }
      default:
        return effect;
    }
  };
  for (const item of shopItems) {
    await step("shop item", `${item.category} / ${item.name}`, async () => {
      const categoryId = categories.get(key(item.category));
      if (!categoryId) throw new Error(`its category "${item.category}" is missing`);
      const items = await listItems(categoryId);
      let present = items.get(key(item.name));
      const known = present !== undefined;
      if (!present) {
        const position = shopItems
          .filter((other) => other.category === item.category)
          .indexOf(item);
        present = await call<ItemRow>("shopItems.create", {
          categoryId,
          name: item.name,
          description: item.description,
          price: item.price,
          isConsumable: item.consumable,
          effect: effectOf(item.effect),
          position,
        });
        items.set(key(item.name), present);
      }
      if (item.image && !present.image) {
        const fileId = await uploadVector(`shop/${item.image}`, "shop_image");
        await call("images.setShopItemImage", { itemId: present.id, fileId });
        present.image = true;
        return "created";
      }
      return known ? "exists" : "created";
    });
  }

  // Awards ---------------------------------------------------------------------------------
  const awardRows = new Map<string, Existing>();
  const awardList = await read<{ items: Existing[] }>("award", "awards.list", {});
  for (const award of awardList?.items ?? []) awardRows.set(key(award.name), award);
  const rankCategory = categories.get(key("Ranks"));
  for (const award of awards) {
    await step("award", award.name, async () => {
      if (!awardList) throw unread("the awards");
      let present = awardRows.get(key(award.name));
      const known = present !== undefined;
      if (!present) {
        let conditions: { criterion: string; value: number }[] = [];
        if (award.criteria) conditions = award.criteria;
        if (award.rankItem) {
          const itemId = rankCategory
            ? (await listItems(rankCategory)).get(key(award.rankItem))?.id
            : undefined;
          if (!itemId) throw new Error(`the rank "${award.rankItem}" is not in the shop`);
          conditions = [{ criterion: "purchased_item", value: itemId }];
        }
        present = await call<Existing>("awards.create", {
          name: award.name,
          description: award.description,
          icon: award.icon,
          tier: award.tier,
          xp: award.xp,
          rule: { match: "all", conditions },
        });
        awardRows.set(key(award.name), present);
        if (award.manual)
          emit({
            outcome: "skipped",
            kind: "award criteria",
            label: award.name,
            note: `loaded as a manual award: ${award.manual}`,
          });
      }
      if (!present.image) {
        const fileId = await uploadVector(`awards/${award.image}`, "award_image");
        await call("images.setAwardImage", { awardId: present.id, fileId });
        present.image = true;
        return "created";
      }
      return known ? "exists" : "created";
    });
  }

  // Site identity --------------------------------------------------------------------------
  let current = await read<Record<string, unknown>>("setting", "settings.get", {});
  for (const [setting, file, purpose] of [
    ["logoFileId", "site/logo.svg", "site_logo"],
    ["iconFileId", "site/icon.svg", "site_icon"],
  ] as const) {
    await step("site picture", setting, async () => {
      if (!current) throw new Error("the settings could not be read");
      if (current[setting]) return "exists";
      const fileId = await uploadVector(file, purpose);
      current = await call<Record<string, unknown>>("settings.update", { [setting]: fileId });
      return "created";
    });
  }

  // Settings: only while still at the backend's own default ---------------------------------
  const wanted = [
    "levelStep",
    "levelTitles",
    "signatureMaxLength",
    "signatureMaxLines",
    "customTitleMaxLength",
    "standingPostPoints",
    "standingReactionsPerPoint",
    "standingReferralPoints",
  ] as const;
  for (const name of wanted) {
    await step("setting", name, async () => {
      if (!current) throw new Error("the settings could not be read");
      const value = settings[name];
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      if (same(current[name], value)) return "exists";
      const field = contracts.SiteSettings.shape[name] as unknown as {
        def: { defaultValue: unknown };
      };
      if (!same(current[name], field.def.defaultValue))
        return { skipped: "an administrator has changed it" };
      current = await call<Record<string, unknown>>("settings.update", { [name]: value });
      return "created";
    });
  }

  // Credit rules ---------------------------------------------------------------------------
  const rules = new Set<string>();
  const ruleList = await read<{ items: { title: string }[] }>(
    "credit rule",
    "creditRules.list",
    {},
  );
  for (const rule of ruleList?.items ?? []) rules.add(key(rule.title));
  for (const rule of settings.creditRules) {
    await step("credit rule", rule.title, async () => {
      if (!ruleList) throw unread("the rules");
      if (rules.has(key(rule.title))) return "exists";
      await call("creditRules.create", rule);
      rules.add(key(rule.title));
      return "created";
    });
  }

  // Reaction types -------------------------------------------------------------------------
  const reactions = new Set<string>();
  const reactionList = await read<{ items: { title: string }[] }>(
    "reaction type",
    "reactionTypes.list",
    {},
  );
  for (const type of reactionList?.items ?? []) reactions.add(key(type.title));
  for (const [at, type] of settings.reactionTypes.entries()) {
    await step("reaction type", type.title, async () => {
      if (!reactionList) throw unread("the reaction types");
      if (reactions.has(key(type.title))) return "exists";
      await call("reactionTypes.create", { ...type, position: (at + 1) * 10 });
      reactions.add(key(type.title));
      return "created";
    });
  }

  // Static pages ---------------------------------------------------------------------------
  const pages = new Set<string>();
  const pageList = await read<{ items: { slug: string }[] }>("page", "pages.list", {});
  for (const page of pageList?.items ?? []) pages.add(page.slug);
  const files = (await readdir(join(root, "pages"))).filter((name) => name.endsWith(".md")).sort();
  for (const file of files) {
    const slug = file.slice(0, -".md".length);
    await step("page", slug, async () => {
      if (!pageList) throw unread("the pages");
      if (pages.has(slug)) return "exists";
      const text = new TextDecoder().decode(await readFile(join(root, "pages", file)));
      const heading = text.match(/^# (.+)\r?\n/);
      if (!heading) throw new Error("the file has no first-level heading to use as the title");
      await call("pages.save", {
        slug,
        title: heading[1],
        body: text.slice(heading[0].length).trim(),
      });
      pages.add(slug);
      return "created";
    });
  }

  return lines;
}
