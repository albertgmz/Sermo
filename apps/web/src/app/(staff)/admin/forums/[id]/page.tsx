import { forumTabsList, nodesGet, nodesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../../registry";
import { FormSkeleton, ListSkeleton, PageHead } from "../../groups/skeletons";
import { Notice } from "../notice";
import { Moderators } from "./moderators";
import { NodeForm } from "./node-form";
import { PicturesForm } from "./pictures-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.edit");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

async function Node({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/forums/[id]">["params"];
  searchParams: PageProps<"/admin/forums/[id]">["searchParams"];
}) {
  const nodeId = parseId((await params).id);
  if (nodeId === null) notFound();
  const [t, viewer, { node }, { items: nodes }, { items: tabs }, query] =
    await Promise.all([
      getTranslations("adminForums.edit"),
      getViewer(),
      read(nodesGet, { nodeId }),
      read(nodesList, {}),
      read(forumTabsList, {}),
      searchParams,
    ]);
  const permissions = hrefFor(viewer, "forumsPermissions");
  const q = Array.isArray(query.q) ? query.q[0] : query.q;
  return (
    <>
      <Notice
        searchParams={searchParams}
        shown={["created", "saved", "pictures", "moderated", "unmoderated"]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
          {node.title}
        </h2>
        <Badge variant="secondary">{t(node.type)}</Badge>
        {permissions && (
          <Link href={`/admin/forums/${node.id}/permissions`} className={link}>
            {t("permissions")}
          </Link>
        )}
        {node.type === "forum" && (
          <Link href={`/forums/${node.id}`} className={link}>
            {t("publicPage")}
          </Link>
        )}
        <Link href="/admin/forums" className={link}>
          {t("back")}
        </Link>
      </div>
      <NodeForm node={node} nodes={nodes} tabs={tabs} />
      <PicturesForm node={node} />
      {viewer.resolvedPermissions["admin.permissions"] === true && (
        <Moderators nodeId={node.id} query={q} />
      )}
    </>
  );
}

export default function ForumPage({
  params,
  searchParams,
}: PageProps<"/admin/forums/[id]">) {
  const t = useTranslations("adminForums.edit");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <FormSkeleton rows={8} />
              <FormSkeleton rows={2} />
              <ListSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Node params={params} searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
