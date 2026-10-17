import { nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { read } from "@/lib/sermo/client";
import { saveOrder } from "../actions";
import { sortableGroups } from "./groups";
import { SortLists } from "./sort-lists";

// The display order of the tree: one list per parent under a single Save, since a node's number
// only counts among the nodes with the same parent. Goes through the tree's order action.
export async function SortGroups() {
  const [t, kind, { items: nodes }] = await Promise.all([
    getTranslations("adminForums.sort"),
    getTranslations("adminForums.tree"),
    read(nodesList, {}),
  ]);
  const titles = new Map(nodes.map((node) => [node.id, node.title]));
  const groups = sortableGroups(nodes);
  if (groups.length === 0) {
    return (
      <EmptyState
        title={t("empty")}
        description={t("emptyDescription")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <SortLists
      action={saveOrder}
      heading={t("heading")}
      groups={groups.map(({ parentId, members }) => ({
        id: String(parentId ?? "top"),
        heading:
          parentId === null
            ? t("topLevel")
            : t("under", { title: titles.get(parentId) ?? `#${parentId}` }),
        items: members.map((node) => ({
          id: node.id,
          title: node.title,
          position: node.position,
          description: kind(node.type),
        })),
      }))}
    />
  );
}
