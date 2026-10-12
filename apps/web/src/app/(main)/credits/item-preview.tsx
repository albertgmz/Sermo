import type { Catalogs, ShopItemData } from "@/app/(main)/credits/items";
import { Art } from "@/components/forum/art";
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
  const art = item.image ? (
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
    const frame = catalogs.frames.get(effect.frameId);
    front = (
      <UserAvatar
        user={{
          ...wearer,
          frame:
            frame?.image && frame.placement
              ? { url: frame.image.url, placement: frame.placement }
              : null,
        }}
        size={size === "card" ? "xl" : "md"}
        link={false}
      />
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
        "relative isolate flex items-center justify-center overflow-hidden",
        BOXES[size],
      )}
    >
      {art}
      {front}
    </div>
  );
}
