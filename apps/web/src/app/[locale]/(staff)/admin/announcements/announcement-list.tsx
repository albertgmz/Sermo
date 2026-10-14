import { announcementsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { HtmlContent } from "@/components/forum/html-content";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { Notice } from "@/components/staff/notice";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

// The announcements sent so far, newest first, with the link to write a new one.
export async function AnnouncementList({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/announcements">["searchParams"];
}) {
  const params = await searchParams;
  const [t, format, page] = await Promise.all([
    getTranslations("adminCommunication.announcements"),
    getFormatter(),
    read(announcementsList, { cursor: cursorFrom(params) }),
  ]);
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{ sent: t("notices.sent") }}
      />
      <div>
        <Link
          href="/admin/announcements/new"
          className={cn(buttonVariants(), "min-h-10 px-4")}
        >
          {t("new")}
        </Link>
      </div>
      <CursorList
        items={page.items}
        nextCursor={page.nextCursor}
        path="/admin/announcements"
        params={params}
        itemKey={(item) => item.id}
        label={t("heading")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
        render={(item) => (
          <div className="space-y-2 p-4">
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">
              {item.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("byline", {
                author: item.author.username,
                date: format.dateTime(new Date(item.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
            <details>
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-primary">
                {t("showText")}
              </summary>
              <HtmlContent className="pb-2 text-sm">
                {item.bodyHtml}
              </HtmlContent>
            </details>
          </div>
        )}
      />
    </>
  );
}
