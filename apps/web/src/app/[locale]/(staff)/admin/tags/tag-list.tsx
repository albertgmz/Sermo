import { tagsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { tagHref } from "@/lib/sermo/tags";
import { cn } from "@/lib/utils";
import { deleteTag } from "./actions";
import { TagRowForms } from "./row-forms";

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

// Every tag by name, with how many threads carry it and its earlier names. Whoever opens the screen
// holds tag.manage, so each row has its forms; the backend checks every action again.
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
  const cursor = first(params.cursor) || undefined;
  const [t, { items, nextCursor }] = await Promise.all([
    getTranslations("adminContent.tags"),
    read(tagsList, { query: query || undefined, cursor }),
  ]);
  const more = new URLSearchParams();
  if (query) more.set("q", query);
  if (nextCursor) more.set("cursor", nextCursor);
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
      <Section heading={t("list.heading")} description={t("list.description")}>
        <form method="get" className="flex gap-2 p-4 pb-0">
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
        {items.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          />
        ) : (
          <ul aria-label={t("list.heading")} className="divide-y">
            {items.map((tag) => (
              <li key={tag.id} className="space-y-3 p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Link
                    href={tagHref(tag.name)}
                    className="text-primary-ink [overflow-wrap:anywhere] hover:underline"
                  >
                    #{tag.name}
                  </Link>
                  <Badge variant="secondary">
                    {t("list.threads", { count: tag.threadCount })}
                  </Badge>
                </p>
                {tag.aliases.length > 0 && (
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t("list.aliases", {
                      names: tag.aliases.map((name) => `#${name}`).join(", "),
                    })}
                  </p>
                )}
                <TagRowForms id={tag.id} name={tag.name} />
                <ConfirmStep
                  action={deleteTag}
                  fields={{ id: String(tag.id) }}
                  summary={t("list.delete")}
                  warning={t("list.deleteWarning", { count: tag.threadCount })}
                  submit={t("list.delete")}
                />
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <p className="p-4 pt-0">
            <Link
              href={`/admin/tags?${more.toString()}`}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 px-3",
              )}
            >
              {t("list.next")}
            </Link>
          </p>
        )}
      </Section>
    </>
  );
}
