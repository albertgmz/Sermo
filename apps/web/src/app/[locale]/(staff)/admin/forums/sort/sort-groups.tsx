import { nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { Notice } from "@/components/staff/notice";
import { SortForm } from "@/components/staff/sort-form";
import { read } from "@/lib/sermo/client";
import { saveOrder } from "../actions";
import { sortableGroups } from "./groups";

// The display order of the tree, one list per parent: a node's number only counts among the nodes
// with the same parent, so each group of two or more is sorted and saved on its own, through the
// tree's order action.
export async function SortGroups({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items: nodes }] = await Promise.all([
    getTranslations("adminForums.sort"),
    read(nodesList, {}),
  ]);
  const kind = await getTranslations("adminForums.tree");
  const titles = new Map(nodes.map((node) => [node.id, node.title]));
  const sortable = sortableGroups(nodes);
  return (
    <>
      <Notice
        namespace="adminForums.notices"
        searchParams={searchParams}
        shown={["ordered"]}
      />
      {sortable.length === 0 ? (
        <EmptyState
          title={t("empty")}
          description={t("emptyDescription")}
          className="rounded-lg border bg-card"
        />
      ) : (
        sortable.map(({ parentId, members }) => (
          <SortForm
            key={parentId ?? "top"}
            action={saveOrder}
            name="position:{id}"
            heading={
              parentId === null
                ? t("topLevel")
                : t("under", { title: titles.get(parentId) ?? `#${parentId}` })
            }
            items={members.map((node) => ({
              id: node.id,
              title: node.title,
              position: node.position,
              description: kind(node.type),
              fields: {
                [`before:${node.id}`]: node.position,
                [`title:${node.id}`]: node.title,
              },
            }))}
          />
        ))
      )}
    </>
  );
}
