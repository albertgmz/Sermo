import { threadPrefixesList } from "@sermo/core/contracts";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import {
  ForumThreadPages,
  forumListAddress,
  threadsPage,
} from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { forumThreadsPage } from "@/app/[locale]/(main)/forums/[id]/threads-page-action";
import { batchUpdateThreadsAction } from "@/app/[locale]/(main)/forums/actions";
import { forumsOtherThan } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { EmptyState } from "@/components/forum/empty-state";
import { PageSwitch } from "@/components/forum/page-switch";
import { pageAddress, pagesOf } from "@/components/forum/page-window";
import { PrefixSelect } from "@/components/forum/prefix-select";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ThreadBatch } from "@/components/staff/thread-batch";
import { batchActionsFor } from "@/components/staff/thread-batch-state";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { THREADS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { activePrefixViews } from "@/lib/sermo/threads";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const filterClass =
  "inline-flex h-10 shrink-0 items-center rounded-md px-1 transition-opacity md:h-7";

// The button that starts a thread in a forum.
export function NewThreadButton({ nodeId }: { nodeId: number }) {
  const t = useTranslations("forums.forum");
  return (
    <Link
      href={`/forums/${nodeId}/new`}
      data-shortcut="create"
      className={cn(buttonVariants(), "h-10 px-3")}
    >
      <Plus />
      {t("newThread")}
    </Link>
  );
}

// The forum's threads narrowed to one prefix, through the shared prefix menu: "All threads" first,
// then the prefixes its threads carry, each choice a link to its list. The forum page draws it
// with the list in a `TabSwitch`, so a choice changes the list in place; without JavaScript the
// choices are the links themselves.
function PrefixFilter({
  id,
  prefixes,
  active,
}: {
  id: number;
  prefixes: PrefixView[];
  active: number | undefined;
}) {
  const t = useTranslations("forums.forum");
  const tFields = useTranslations("forum.threadFields");
  const hrefOf = (prefix: number | undefined) =>
    prefix === undefined ? `/forums/${id}` : `/forums/${id}?prefix=${prefix}`;
  const hrefs: Record<string, string> = { "": hrefOf(undefined) };
  for (const prefix of prefixes) hrefs[String(prefix.id)] = hrefOf(prefix.id);
  return (
    <nav aria-label={t("aria.prefixFilter")} className="mt-3 flex">
      <PrefixSelect
        prefixes={prefixes}
        value={active === undefined ? "" : String(active)}
        none={t("allThreads")}
        label={tFields("prefixLabel")}
        hrefs={hrefs}
      />
      <noscript>
        <span className="-mx-1 flex flex-wrap">
          <Link
            href={hrefOf(undefined)}
            className={cn(
              filterClass,
              "px-2 text-xs font-medium text-muted-foreground",
            )}
          >
            {t("allThreads")}
          </Link>
          {prefixes.map((prefix) => (
            <Link
              key={prefix.id}
              href={hrefOf(prefix.id)}
              aria-current={prefix.id === active ? "true" : undefined}
              className={filterClass}
            >
              <PrefixTag prefix={prefix} />
            </Link>
          ))}
        </span>
      </noscript>
    </nav>
  );
}

export async function ForumThreads({
  nodeId,
  prefix,
  page,
  newThread,
  signedIn,
  resolved,
}: {
  nodeId: number;
  prefix: string | undefined;
  page: number;
  newThread: React.ReactNode;
  signedIn: boolean;
  // The viewer's permissions in the forum, for the staff tools on its list.
  resolved: Record<string, boolean | number>;
}) {
  const prefixId = /^[1-9]\d*$/.test(prefix ?? "") ? Number(prefix) : undefined;
  const [first, { items: allPrefixes }, { items: carried }, t] =
    await Promise.all([
      threadsPage(nodeId, prefixId, page),
      read(threadPrefixesList, { nodeId }),
      read(threadPrefixesList, { nodeId, carried: true }),
      getTranslations("forums.forum"),
    ]);
  // The batch tools set the prefixes the forum offers; the filter also lists a prefix the forum
  // stopped offering while threads still carry it.
  const prefixes = activePrefixViews(allPrefixes);
  const filterPrefixes = activePrefixViews(carried);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(first.total, THREADS_PER_PAGE);
  if (page > pages) {
    const { path, params } = forumListAddress(nodeId, prefixId);
    redirect(pageAddress(path, params, pages));
  }
  const listed = first.rows.length > 0;
  // Staff who may change threads tick them in the list and apply one change to all.
  const batchActions = listed ? batchActionsFor(resolved) : [];
  const batchForums = batchActions.includes("move")
    ? (await forumsOtherThan(nodeId)).map(({ id, title }) => ({
        id,
        label: title,
      }))
    : [];

  return (
    <>
      {filterPrefixes.length > 0 && (
        <PrefixFilter id={nodeId} prefixes={filterPrefixes} active={prefixId} />
      )}

      <div data-switch-panel="">
        {listed ? (
          <ThreadBatch
            action={batchUpdateThreadsAction.bind(null, nodeId)}
            actions={batchActions}
            forums={batchForums}
            prefixes={prefixes.map(({ id, label }) => ({ id, label }))}
          >
            <PageSwitch
              page={page}
              stamp={Date.now()}
              load={forumThreadsPage.bind(null, nodeId, prefixId)}
              className={filterPrefixes.length > 0 ? "mt-1" : "mt-4"}
            >
              <ForumThreadPages
                nodeId={nodeId}
                prefixId={prefixId}
                page={page}
                list={first}
              />
            </PageSwitch>
          </ThreadBatch>
        ) : (
          <div
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              filterPrefixes.length > 0 ? "mt-1" : "mt-4",
            )}
          >
            <EmptyState
              icon={MessagesSquare}
              title={t("empty")}
              description={
                newThread
                  ? t("emptyMemberDescription")
                  : signedIn
                    ? undefined
                    : t("emptyGuestDescription")
              }
            >
              {newThread}
            </EmptyState>
          </div>
        )}
      </div>
    </>
  );
}
