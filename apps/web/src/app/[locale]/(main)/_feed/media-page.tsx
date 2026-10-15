import { mediaList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { Art } from "@/components/forum/art";
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
                      <Art
                        category="postImages"
                        src={item.file.thumbnailUrl ?? item.file.url}
                        className="absolute inset-0"
                      />
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
