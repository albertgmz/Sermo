import { forumTabsList, nodesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FormRows } from "@/components/staff/form-rows";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../registry";
import { saveOrder } from "./actions";
import { NodeCreateForm } from "./node-create-form";
import { Notice } from "./notice";
import { TabsPanel } from "./tabs-panel";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// The categories and forums as nested rows in the tree's own order, with one box per row for the
// display order (saved together), then the forms for a new category and a new forum and the
// forum list tabs.
export async function ForumTree({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, viewer, { items: nodes }, { items: tabs }] = await Promise.all([
    getTranslations("adminForums.tree"),
    getViewer(),
    read(nodesList, {}),
    read(forumTabsList, {}),
  ]);
  const permissions = hrefFor(viewer, "forumsPermissions");
  return (
    <>
      <Notice
        searchParams={searchParams}
        shown={["ordered", "tabAdded", "tabSaved", "tabDeleted"]}
      />
      {nodes.length > 0 ? (
        <FormRows
          action={saveOrder}
          heading={t("heading")}
          description={t("description")}
          submit={t("saveOrder")}
        >
          {nodes.map((node) => (
            <div
              key={node.id}
              className="flex flex-col gap-3 py-3 pe-4 md:flex-row md:items-center"
              style={{ paddingInlineStart: `${1 + node.depth * 1.5}rem` }}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/forums/${node.id}`}
                    className="text-sm font-semibold [overflow-wrap:anywhere] hover:underline"
                  >
                    {node.title}
                  </Link>
                  <Badge
                    variant={node.type === "category" ? "secondary" : "outline"}
                  >
                    {t(node.type)}
                  </Badge>
                  {node.settings.isReadOnly && (
                    <Badge variant="outline">{t("readOnly")}</Badge>
                  )}
                </p>
                {node.type === "forum" && (
                  <p className="text-xs text-muted-foreground">
                    {t("counts", {
                      threads: node.threadCount,
                      posts: node.postCount,
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`position-${node.id}`}
                  className="text-xs text-muted-foreground"
                >
                  {t("order")}
                  <span className="sr-only"> — {node.title}</span>
                </label>
                <input
                  type="hidden"
                  name={`before:${node.id}`}
                  value={node.position}
                />
                <Input
                  id={`position-${node.id}`}
                  name={`position:${node.id}`}
                  type="number"
                  inputMode="numeric"
                  required
                  defaultValue={node.position}
                  className="w-24"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/forums/${node.id}`} className={link}>
                  {t("edit")}
                </Link>
                {permissions && (
                  <Link
                    href={`/admin/forums/${node.id}/permissions`}
                    className={link}
                  >
                    {t("permissions")}
                  </Link>
                )}
                {node.type === "forum" && (
                  <Link href={`/forums/${node.id}`} className={link}>
                    {t("publicPage")}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </FormRows>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      )}
      <NodeCreateForm type="category" nodes={nodes} tabs={tabs} />
      <NodeCreateForm type="forum" nodes={nodes} tabs={tabs} />
      <TabsPanel tabs={tabs} />
    </>
  );
}
