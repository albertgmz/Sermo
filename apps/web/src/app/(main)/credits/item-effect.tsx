import { useTranslations } from "next-intl";
import type { Catalogs, ShopItemData } from "@/app/(main)/credits/items";
import { formatNumber } from "@/lib/format";

// The permissions that have a name of their own; any other is shown by its id.
const PERMISSION_KEYS = {
  "profile.signature": "signature",
  "profile.customTitle": "customTitle",
  "profile.coverPreset": "coverPreset",
  "profile.renameFree": "renameFree",
  "profile.awardSlots": "awardSlots",
  "mention.maxPerItem": "mentionLimit",
  "conversation.maxRecipients": "recipientLimit",
} as const;

function permissionKey(id: string) {
  return id in PERMISSION_KEYS
    ? PERMISSION_KEYS[id as keyof typeof PERMISSION_KEYS]
    : null;
}

// What an item does, in words, from its effect. A group item says nothing here: the item's own
// name and description are what a member is told about a rank.
export function ItemEffect({
  item,
  catalogs,
}: {
  item: Pick<ShopItemData, "effect">;
  catalogs: Catalogs;
}) {
  const t = useTranslations("credits.effect");
  const permissions = useTranslations("credits.permissions");
  const { effect } = item;
  switch (effect.type) {
    case "frame": {
      const frame = catalogs.frames.get(effect.frameId);
      return frame ? t("frame", { name: frame.name }) : t("frameUnnamed");
    }
    case "nameColor": {
      const color = catalogs.colors.get(effect.colorId);
      return color
        ? t("nameColor", { name: color.name })
        : t("nameColorUnnamed");
    }
    case "nameIcon":
      return t("nameIcon", { position: effect.position });
    case "threadCover": {
      const cover = catalogs.covers.get(effect.coverId);
      return cover
        ? t("threadCover", { name: cover.name })
        : t("threadCoverUnnamed");
    }
    case "highlight":
      return t("highlight", { days: effect.days });
    case "bump":
      return t("bump");
    case "usernameChange":
      return t("usernameChange");
    case "permission": {
      const key = permissionKey(effect.permission);
      const name = key ? permissions(key) : effect.permission;
      if (effect.value === undefined) return t("permission", { name });
      return t("permissionValue", {
        name,
        unlimited: String(effect.value === -1),
        value: formatNumber(effect.value),
      });
    }
    case "group":
      return null;
  }
}

// How long a temporary item lasts, in the largest whole unit.
export function Lasts({ seconds }: { seconds: number }) {
  const t = useTranslations("credits.effect");
  if (seconds % 86_400 === 0)
    return t("lastsDays", { count: seconds / 86_400 });
  if (seconds % 3_600 === 0) return t("lastsHours", { count: seconds / 3_600 });
  return t("lastsMinutes", { count: Math.ceil(seconds / 60) });
}
