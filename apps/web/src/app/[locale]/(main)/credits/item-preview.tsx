import type {
  Catalogs,
  ShopItemData,
} from "@/app/[locale]/(main)/credits/items";
import { Art } from "@/components/forum/art";
import { NameWithIcon } from "@/components/forum/name-icon";
import { ShopIcon } from "@/components/forum/shop-icon";
import { type AvatarUser, UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import { cn } from "@/lib/utils";

// Whose avatar and name an item is tried on.
export type Wearer = AvatarUser & { nameColor: string | null };

const BOXES = {
  card: "aspect-video border-b",
  thumb: "h-14 w-16 shrink-0 rounded-md border",
};

// How much of the picture box a worn frame fills, in percent of its shorter side.
const FRAME_FILL = 80;

// An item's picture: its own, else the one its effect names (a cover), with the effect tried on
// the viewer where it can be (a frame around their avatar, a colour on their name). An item with
// neither shows the glyph of its effect.
export function ItemPreview({
  item,
  catalogs,
  wearer,
  size = "card",
}: {
  item: Pick<ShopItemData, "effect" | "image">;
  catalogs: Catalogs;
  wearer: Wearer;
  size?: keyof typeof BOXES;
}) {
  const { effect } = item;
  const cover =
    effect.type === "threadCover" ? catalogs.covers.get(effect.coverId) : null;
  const frame =
    effect.type === "frame" ? catalogs.frames.get(effect.frameId) : undefined;
  const worn =
    frame?.image && frame.placement
      ? { url: frame.image.url, placement: frame.placement }
      : null;
  // The avatar wearing the frame is the preview: the item's own picture, usually the frame
  // itself, would draw it a second time behind.
  const art = worn ? null : item.image ? (
    <Art
      category="shop"
      src={item.image.url}
      className="absolute inset-0 -z-10"
    />
  ) : cover?.image ? (
    <Art
      category="threadCovers"
      src={cover.image.url}
      className="absolute inset-0 -z-10"
    />
  ) : null;

  let front: React.ReactNode = null;
  if (effect.type === "frame") {
    // The frame is drawn wider than the avatar (its placement is a percentage of the avatar's
    // width), so the avatar is sized from the box to leave the whole frame inside it.
    const side = worn ? FRAME_FILL / (worn.placement.width / 100) : 0;
    const fit = `min(${side}cqh, ${side}cqw)`;
    front = (
      <div
        className="shrink-0"
        style={worn ? { width: fit, height: fit } : undefined}
      >
        <UserAvatar
          user={{ ...wearer, frame: worn }}
          size={worn ? "2xl" : size === "card" ? "xl" : "md"}
          link={false}
          className={worn ? "size-full" : undefined}
        />
      </div>
    );
  } else if (effect.type === "nameColor") {
    const name = userNameProps({
      nameColor: catalogs.colors.get(effect.colorId)?.color ?? null,
    });
    front = (
      <p
        className={cn(
          "min-w-0 truncate font-bold tracking-tight",
          size === "card" ? "px-3 text-2xl" : "px-1 text-xs",
          name.className,
        )}
        style={name.style}
      >
        {wearer.username}
      </p>
    );
  } else if (effect.type === "nameIcon") {
    front = (
      <p
        className={cn(
          "min-w-0 truncate font-bold tracking-tight",
          size === "card" ? "px-3 text-2xl" : "px-1 text-xs",
        )}
      >
        <NameWithIcon
          user={{
            username: wearer.username,
            nameIcon: { icon: effect.icon, position: effect.position },
          }}
        />
      </p>
    );
  } else if (!art) {
    front = (
      <ShopIcon
        type={effect.type}
        className={cn(
          "text-muted-foreground",
          size === "card" ? "size-10" : "size-6",
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative isolate flex items-center justify-center overflow-hidden [container-type:size]",
        BOXES[size],
      )}
    >
      {art}
      {front}
    </div>
  );
}
