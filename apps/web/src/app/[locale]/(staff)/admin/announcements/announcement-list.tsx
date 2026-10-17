import { announcementsList } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { HtmlContent } from "@/components/forum/html-content";
import { cursorFrom } from "@/components/staff/cursor-list";
import { ItemList } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { read } from "@/lib/sermo/client";
import { PagingNav } from "../content-kit/paging-nav";
import { groupsIfAllowed } from "../groups/data";

// The announcements sent so far, newest first. A sent alert cannot be changed, so a row has no
// edit link: it shows who sent it, to whom, and the text behind a disclosure.
export async function AnnouncementList({
  searchParams,
  addAction,
}: {
  searchParams: PageProps<"/[locale]/admin/announcements">["searchParams"];
  // The "New alert" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const params = await searchParams;
  const cursor = cursorFrom(params);
  const [t, format, page, groups] = await Promise.all([
    getTranslations("adminCommunication.announcements"),
    getFormatter(),
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
                {t("byline", {
                  author: item.author.username,
                  date: format.dateTime(new Date(item.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
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
      <PagingNav
        path="/admin/announcements"
        params={params}
        cursor={cursor}
        nextCursor={page.nextCursor}
      />
    </>
  );
}
