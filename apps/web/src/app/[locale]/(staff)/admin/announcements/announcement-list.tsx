import { announcementsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { HtmlContent } from "@/components/forum/html-content";
import { RelativeTime } from "@/components/forum/relative-time";
import { cursorFrom } from "@/components/staff/cursor-list";
import { ItemList } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { read } from "@/lib/sermo/client";
import { groupsIfAllowed } from "../groups/data";

// The announcements sent so far, newest first. A sent alert cannot be changed, so a row has no
// edit link: it shows who sent it, to whom, and the text behind a disclosure.
export async function AnnouncementList({
  searchParams,
  addAction,
}: {
  searchParams: PageProps<"/[locale]/admin/announcements">["searchParams"];
  // The "Add alert" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const params = await searchParams;
  const cursor = cursorFrom(params);
  const [t, page, groups] = await Promise.all([
    getTranslations("adminCommunication.announcements"),
    read(announcementsList, { cursor }),
    groupsIfAllowed(),
  ]);
  const audienceOf = (audience: (typeof page.items)[number]["audience"]) =>
    audience.kind === "group"
      ? t("audience.group", {
          group:
            groups?.find((group) => group.id === audience.groupId)?.title ??
            `#${audience.groupId}`,
        })
      : audience.kind === "users"
        ? t("audience.users", { names: audience.usernames.join(", ") })
        : t("audience.all");
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ sent: t("notices.sent") }}
      />
      <ItemList
        paging={{
          path: "/admin/announcements",
          params,
          nextCursor: page.nextCursor,
        }}
        label={t("heading")}
        heading={t("heading")}
        empty={{
          title: t("emptyTitle"),
          description: t("emptyDescription"),
          action: addAction,
        }}
        items={page.items.map((item) => ({
          id: item.id,
          title: item.title,
          description: (
            <>
              <span className="block">
                {t.rich("byline", {
                  author: item.author.username,
                  time: (chunks) => (
                    <RelativeTime date={item.createdAt}>{chunks}</RelativeTime>
                  ),
                })}
              </span>
              <span className="block">
                {audienceOf(item.audience)}
                {item.url && ` · ${t("link", { url: item.url })}`}
              </span>
            </>
          ),
          panel: (
            <details>
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-primary-ink">
                {t("showText")}
              </summary>
              <HtmlContent className="pb-2 text-sm">
                {item.bodyHtml}
              </HtmlContent>
            </details>
          ),
        }))}
      />
    </>
  );
}
