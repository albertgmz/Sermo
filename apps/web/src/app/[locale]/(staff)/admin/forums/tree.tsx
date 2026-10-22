import { forumTabsList, nodesList } from "@sermo/core/contracts";
import {
  ExternalLink,
  Folder,
  MessagesSquare,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { iconComponent } from "@/components/icons/icon-set";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { HeaderLink } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../registry";
import { deleteTab } from "./actions";

// The categories and forums as rows in the tree's own order (the depth shown as dashes before the
// title), each with its edit link, then the forum list tabs the same way.
export async function ForumTree({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, tt, viewer, { items: nodes }, { items: tabs }] = await Promise.all([
    getTranslations("adminForums.tree"),
    getTranslations("adminForums.tabs"),
    getViewer(),
    read(nodesList, {}),
    read(forumTabsList, {}),
  ]);
  const permissions = hrefFor(viewer, "forumsPermissions");
  return (
    <>
      <Notice
        namespace="adminForums.notices"
        searchParams={searchParams}
        shown={["ordered", "tabAdded", "tabSaved", "tabDeleted", "nodeDeleted"]}
      />
      <ItemList
        label={t("listLabel")}
        filter
        empty={{ title: t("empty"), description: t("emptyDescription") }}
        items={nodes.map((node) => {
          const Icon =
            iconComponent(node.iconKey) ??
            (node.type === "category" ? Folder : MessagesSquare);
          return {
            id: node.id,
            search: node.title,
            icon: <Icon aria-hidden="true" className="size-5" />,
            title: (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  {"— ".repeat(node.depth)}
                </span>
                {node.title}
              </>
            ),
            href: `/admin/forums/${node.id}`,
            description:
              node.type === "forum"
                ? t("counts", {
                    threads: node.threadCount,
                    posts: node.postCount,
                  })
                : undefined,
            badges: (
              <>
                <Badge
                  variant={node.type === "category" ? "secondary" : "outline"}
                >
                  {t(node.type)}
                </Badge>
                {node.settings.isReadOnly && (
                  <Badge variant="outline">{t("readOnly")}</Badge>
                )}
              </>
            ),
            actions: (
              <>
                <RowLink
                  href={`/admin/forums/${node.id}`}
                  label={t("edit", { title: node.title })}
                />
                {permissions && (
                  <RowLink
                    href={`/admin/forums/${node.id}/permissions`}
                    label={t("permissions", { title: node.title })}
                    icon={<ShieldCheck />}
                  />
                )}
                {node.type === "forum" && (
                  <RowLink
                    href={`/forums/${node.id}`}
                    label={t("publicPage", { title: node.title })}
                    icon={<ExternalLink />}
                  />
                )}
              </>
            ),
          };
        })}
      />
      <div id="tabs" className="scroll-mt-4">
        <ItemList
          label={tt("heading")}
          heading={tt("heading")}
          description={tt("description")}
          action={
            <HeaderLink
              href="/admin/forums/tabs/new"
              icon={<Plus aria-hidden="true" />}
            >
              {tt("add")}
            </HeaderLink>
          }
          empty={{ title: tt("none") }}
          items={tabs.map((tab) => ({
            id: tab.id,
            title: tab.title,
            href: `/admin/forums/tabs/${tab.id}`,
            description: tt("order", { position: tab.position }),
            actions: (
              <>
                <RowLink
                  href={`/admin/forums/tabs/${tab.id}`}
                  label={tt("edit", { title: tab.title })}
                />
                <ConfirmStep
                  action={deleteTab}
                  fields={{ id: tab.id }}
                  summary={`${tt("delete")}…`}
                  warning={tt("deleteWarning", { title: tab.title })}
                  submit={tt("delete")}
                />
              </>
            ),
          }))}
        />
      </div>
    </>
  );
}
