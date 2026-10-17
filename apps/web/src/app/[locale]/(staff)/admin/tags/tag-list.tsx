import { tagsList } from "@sermo/core/contracts";
import { ExternalLink } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { tagHref } from "@/lib/sermo/tags";
import { cn } from "@/lib/utils";
import { PagingNav } from "../content-kit/paging-nav";
import { deleteTag } from "./actions";

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

// Every tag by name, with how many threads carry it and its earlier names. Whoever opens the screen
// holds tag.manage; the backend checks every action again.
export async function TagList({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string | string[];
    q?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const cursor = cursorFrom(params);
  const [t, { items, nextCursor }] = await Promise.all([
    getTranslations("adminContent.tags"),
    read(tagsList, { query: query || undefined, cursor }),
  ]);
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          renamed: t("notices.renamed"),
          merged: t("notices.merged"),
          deleted: t("notices.deleted"),
        }}
      />
      <form method="get" className="flex gap-2 rounded-lg border bg-card p-3">
        <Input
          name="q"
          defaultValue={query}
          aria-label={t("list.searchLabel")}
          placeholder={t("list.searchPlaceholder")}
          autoComplete="off"
          autoCapitalize="none"
        />
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-3")}
        >
          {t("list.search")}
        </button>
      </form>
      <ItemList
        label={t("list.heading")}
        heading={t("list.heading")}
        description={t("list.description")}
        empty={{
          title: t("list.emptyTitle"),
          description: t("list.emptyDescription"),
        }}
        items={items.map((tag) => ({
          id: tag.id,
          title: `#${tag.name}`,
          href: `/admin/tags/${tag.id}?name=${encodeURIComponent(tag.name)}`,
          badges: (
            <Badge variant="secondary">
              {t("list.threads", { count: tag.threadCount })}
            </Badge>
          ),
          description:
            tag.aliases.length > 0
              ? t("list.aliases", {
                  names: tag.aliases.map((name) => `#${name}`).join(", "),
                })
              : undefined,
          actions: (
            <>
              <RowLink
                href={tagHref(tag.name)}
                label={t("list.view", { name: tag.name })}
                icon={<ExternalLink />}
              />
              <RowLink
                href={`/admin/tags/${tag.id}?name=${encodeURIComponent(tag.name)}`}
                label={t("list.edit", { name: tag.name })}
              />
              <ConfirmStep
                action={deleteTag}
                fields={{ id: String(tag.id) }}
                summary={t("list.delete")}
                warning={t("list.deleteWarning", { count: tag.threadCount })}
                submit={t("list.delete")}
              />
            </>
          ),
        }))}
      />
      <PagingNav
        path="/admin/tags"
        params={params}
        cursor={cursor}
        nextCursor={nextCursor}
      />
    </>
  );
}
