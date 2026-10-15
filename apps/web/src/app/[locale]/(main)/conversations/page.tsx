import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { conversationsPage } from "@/app/[locale]/(main)/conversations/conversation-page";
import { moreConversations } from "@/app/[locale]/(main)/conversations/more-conversations";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PagedList } from "@/components/forum/paged-list";
import {
  ConversationListSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { pagesParam } from "@/lib/list-pages";
import { cn } from "@/lib/utils";

export default async function ConversationsPage({
  searchParams,
}: PageProps<"/[locale]/conversations">) {
  const t = await getTranslations("conversations.list");
  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb items={[{ label: t("home"), href: "/" }]} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("heading")}
        </h1>
        <Link
          href="/conversations/new"
          className={cn(buttonVariants(), "h-10 shrink-0 px-3 md:h-8")}
        >
          <Plus />
          {t("newConversation")}
        </Link>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingConversations")}>
              <ConversationListSkeleton />
            </LoadingRegion>
          }
        >
          <ConversationList searchParams={searchParams} />
        </Suspense>
      </div>
    </PageLayout>
  );
}

async function ConversationList({
  searchParams,
}: Pick<PageProps<"/[locale]/conversations">, "searchParams">) {
  const [params, t] = await Promise.all([
    searchParams,
    getTranslations("conversations.list"),
  ]);
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const first = await conversationsPage(cursor);

  if (!first.rows.length && !first.nextCursor) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    );
  }
  return (
    <PagedList
      first={first}
      more={moreConversations}
      pages={pagesParam(params.pages)}
      start={cursor}
      listKey={["conversations"]}
      hrefBase="/conversations"
      moreLabel={t("older")}
      estimateSize={72}
      as="ul"
      moreClassName="p-2"
    />
  );
}
