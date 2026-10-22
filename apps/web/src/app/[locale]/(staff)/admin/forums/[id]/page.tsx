import {
  forumTabsList,
  nodesGet,
  nodesList,
  threadPrefixesList,
} from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Notice } from "@/components/staff/notice";
import { HeaderLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../../registry";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { DeleteNode } from "./delete-node";
import Loading from "./loading";
import { Moderators } from "./moderators";
import { NodeForm } from "./node-form";
import { PicturesForm } from "./pictures-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.edit");
  return { title: t("metaTitle") };
}

type Props = PageProps<"/[locale]/admin/forums/[id]">;

// The node's own name is the page's heading, so the whole frame waits for the read.
async function Node({ params, searchParams }: Props) {
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
  // The prefixes are a forum's alone: a category reads none.
  const [{ items: prefixes }, { items: offered }] =
    node.type === "forum"
      ? await Promise.all([
          read(threadPrefixesList, {}),
          read(threadPrefixesList, { nodeId }),
        ])
      : [{ items: [] }, { items: [] }];
  const permissions = hrefFor(viewer, "forumsPermissions");
  const managePrefixes = hrefFor(viewer, "forumsPrefixes");
  const q = Array.isArray(query.q) ? query.q[0] : query.q;
  return (
    <ScreenFrame
      trail={staffTrail(`/admin/forums/${node.id}`)}
      heading={node.title}
      subtitle={t(
        viewer.resolvedPermissions["admin.permissions"] === true
          ? "subtitleModerators"
          : "subtitle",
        { type: t(node.type) },
      )}
      actions={
        <>
          {permissions && (
            <HeaderLink href={`/admin/forums/${node.id}/permissions`}>
              {t("permissions")}
            </HeaderLink>
          )}
          {node.type === "forum" && managePrefixes && (
            <HeaderLink href="/admin/forums/prefixes">
              {t("managePrefixes")}
            </HeaderLink>
          )}
          {node.type === "forum" && (
            <HeaderLink href={`/forums/${node.id}`}>
              {t("publicPage")}
            </HeaderLink>
          )}
        </>
      }
      label={t("loading")}
      fallback={<FormSkeleton rows={8} />}
    >
      <Notice
        namespace="adminForums.notices"
        searchParams={searchParams}
        shown={["created", "saved", "pictures", "moderated", "unmoderated"]}
      />
      <NodeForm
        node={node}
        nodes={nodes}
        tabs={tabs}
        prefixes={prefixes}
        offered={new Set(offered.map((prefix) => prefix.id))}
      />
      <PicturesForm node={node} />
      {viewer.resolvedPermissions["admin.permissions"] === true && (
        <Moderators nodeId={node.id} query={q} />
      )}
      <DeleteNode node={node} nodes={nodes} />
    </ScreenFrame>
  );
}

export default function ForumPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Node params={params} searchParams={searchParams} />
    </Suspense>
  );
}
