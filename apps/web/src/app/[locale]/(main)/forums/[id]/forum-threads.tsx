import { threadPrefixesList } from "@sermo/core/contracts";
import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
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
import { PendingChoice } from "@/components/forum/pending-choice";
import { PrefixSelect } from "@/components/forum/prefix-select";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  LoadingRegion,
  ThreadListSkeleton,
} from "@/components/forum/skeletons";
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
// then the prefixes its threads carry, each choice a link to its list. A choice is a navigation:
// the filter stays as it is and the list comes in behind its placeholder (`ForumThreads`); without
// JavaScript the choices are the links themselves.
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

type ThreadsProps = {
  nodeId: number;
  prefix: string | undefined;
  page: number;
  newThread: React.ReactNode;
  signedIn: boolean;
  // The viewer's permissions in the forum, for the staff tools on its list.
  resolved: Record<string, boolean | number>;
};

// The forum's prefix filter and its threads. The list is drawn again for each prefix (its key), so
// its placeholder shows at once while the filter, which a choice keeps on screen, stays.
export async function ForumThreads(props: ThreadsProps) {
  const { nodeId } = props;
  const prefixId = /^[1-9]\d*$/.test(props.prefix ?? "")
    ? Number(props.prefix)
    : undefined;
  const [{ items: carried }, t] = await Promise.all([
    read(threadPrefixesList, { nodeId, carried: true }),
    getTranslations("forums.forum"),
  ]);
  // The filter also lists a prefix the forum stopped offering while threads still carry it.
  const filterPrefixes = activePrefixViews(carried);
  const spaced = filterPrefixes.length > 0 ? "mt-1" : "mt-4";
  return (
    <PendingChoice>
      {filterPrefixes.length > 0 && (
        <PrefixFilter id={nodeId} prefixes={filterPrefixes} active={prefixId} />
      )}
      <Suspense
        key={prefixId ?? ""}
        fallback={
          <LoadingRegion label={t("aria.loadingThreads")}>
            <ThreadListSkeleton className={spaced} />
          </LoadingRegion>
        }
      >
        <ThreadsList {...props} prefixId={prefixId} spaced={spaced} />
      </Suspense>
    </PendingChoice>
  );
}

async function ThreadsList({
  nodeId,
  prefixId,
  page,
  newThread,
  signedIn,
  resolved,
  spaced,
}: Omit<ThreadsProps, "prefix"> & {
  prefixId: number | undefined;
  // The gap above the list: closer under the filter.
  spaced: string;
}) {
  const [first, { items: allPrefixes }, t] = await Promise.all([
    threadsPage(nodeId, prefixId, page),
    read(threadPrefixesList, { nodeId }),
    getTranslations("forums.forum"),
  ]);
  // The batch tools set the prefixes the forum offers.
  const prefixes = activePrefixViews(allPrefixes);
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
            className={spaced}
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
          className={cn("overflow-hidden rounded-lg border bg-card", spaced)}
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
  );
}
