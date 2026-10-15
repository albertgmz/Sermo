import { mediaList } from "@sermo/core/contracts";
import { ImageIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { LazyArt } from "@/components/forum/art";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";

// One page of the media tab, drawn: each picture is a thumbnail that opens the post it is in. A
// page is one row of the infinite list, a grid that wraps by itself whatever the width.
export async function mediaPage(
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [media, t] = await Promise.all([
    reader(mediaList, { cursor }),
    getTranslations("home.media"),
  ]);
  const [first] = media.items;
  return {
    nextCursor: media.nextCursor,
    rows: first
      ? [
          {
            key: `media-${first.id}`,
            node: (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {media.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={
                        item.type === "post"
                          ? threadHref(
                              item.threadId,
                              item.position,
                              item.postId,
                            )
                          : wallTargetHref(
                              item.profileUserId,
                              item.profilePostId,
                            )
                      }
                      aria-label={
                        item.type === "post"
                          ? t("inThread", { title: item.threadTitle })
                          : t("onProfile")
                      }
                      className="relative block aspect-square overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.file.thumbnailUrl ? (
                        <LazyArt
                          category="postImages"
                          src={item.file.thumbnailUrl}
                          className="absolute inset-0 size-full"
                        />
                      ) : (
                        // The original may be large (or an animation): the tile links to the
                        // post, which draws it, and shows an icon until then.
                        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          <ImageIcon aria-hidden="true" className="size-6" />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : [],
  };
}
