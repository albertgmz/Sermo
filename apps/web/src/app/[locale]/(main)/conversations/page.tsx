import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  CONVERSATIONS_PER_PAGE,
  ConversationPages,
  conversationsPage,
} from "@/app/[locale]/(main)/conversations/conversation-page";
import { conversationsPageAction } from "@/app/[locale]/(main)/conversations/conversations-page-action";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageSwitch } from "@/components/forum/page-switch";
import {
  pageAddress,
  pageParam,
  pagesOf,
} from "@/components/forum/page-window";
import {
  ConversationListSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
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
      <div className="mt-4">
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingConversations")}>
              <div className="overflow-hidden rounded-lg border bg-card">
                <ConversationListSkeleton />
              </div>
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
  const page = pageParam(params.page);
  const first = await conversationsPage(page);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(first.total, CONVERSATIONS_PER_PAGE);
  if (page > pages) redirect(pageAddress("/conversations", {}, pages));

  if (first.rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-lg border bg-card">
        <EmptyState
          icon={MessagesSquare}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }
  return (
    <PageSwitch page={page} stamp={Date.now()} load={conversationsPageAction}>
      <ConversationPages page={page} list={first} />
    </PageSwitch>
  );
}
