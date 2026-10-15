import { mediaList } from "@sermo/core/contracts";
import { ImageIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { LazyArt } from "@/components/forum/art";
import { PictureCard, PictureGrid } from "@/components/forum/picture-grid";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { pictureEntry, picturesBlocked } from "@/lib/sermo/media-pictures";

// One page of the media tab, drawn: each picture is a large card, a thumbnail that opens the
// picture viewer (or, without scripts, the post it is in) and a line naming where it is. A page is
// one row of the infinite list, a grid that wraps by itself whatever the width.
export async function mediaPage(
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [media, t, blocked] = await Promise.all([
    reader(mediaList, { cursor }),
    getTranslations("home.media"),
    picturesBlocked(),
  ]);
  const [first] = media.items;
  const labelOf = (item: (typeof media.items)[number]) =>
    item.type === "post"
      ? t("inThread", { title: item.threadTitle })
      : t("onProfile");
  const entries = media.items.map((item) =>
    pictureEntry(item, labelOf(item), blocked),
  );
  return {
    nextCursor: media.nextCursor,
    rows: first
      ? [
          {
            key: `media-${first.id}`,
            node: (
              <PictureGrid entries={entries}>
                {media.items.map((item, index) => {
                  const href =
                    item.type === "post"
                      ? threadHref(item.threadId, item.position, item.postId)
                      : wallTargetHref(item.profileUserId, item.profilePostId);
                  return (
                    <li
                      key={item.id}
                      className="overflow-hidden rounded-lg border bg-card"
                    >
                      <PictureCard
                        picture={entries[index].ref}
                        href={href}
                        label={labelOf(item)}
                      >
                        {item.file.thumbnailUrl ? (
                          <LazyArt
                            category="postImages"
                            src={item.file.thumbnailUrl}
                            className="absolute inset-0 size-full"
                          />
                        ) : (
                          // The original may be large (or an animation): the card shows an icon
                          // and the viewer draws the picture when it is opened.
                          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                            <ImageIcon aria-hidden="true" className="size-8" />
                          </span>
                        )}
                      </PictureCard>
                      <Link
                        href={href}
                        prefetch={false}
                        className="flex h-10 items-center px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      >
                        <span className="truncate">
                          {item.type === "post"
                            ? item.threadTitle
                            : t("wallPost")}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </PictureGrid>
            ),
          },
        ]
      : [],
  };
}
