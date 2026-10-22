import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Help, selectClass } from "@/components/staff/rows";
import { Label } from "@/components/ui/label";
import { deleteNode } from "../actions";
import { NodeOptions, type TreeNode } from "../node-options";

// The nodes under `node` in the tree's own order (a node is followed by the ones below it).
function below(nodes: readonly TreeNode[], node: TreeNode) {
  const start = nodes.findIndex((entry) => entry.id === node.id);
  const result: TreeNode[] = [];
  for (const entry of nodes.slice(start + 1)) {
    if (entry.depth <= node.depth) break;
    result.push(entry);
  }
  return result;
}

const radioClass = "size-4 accent-primary";

// Deleting a category or forum: the threads move to another forum or go for good, and the nodes
// under it move up or go with it. The work is queued in the backend and finished in the
// background, so the confirmation says so. Reached from the node's own page.
export async function DeleteNode({
  node,
  nodes,
}: {
  node: TreeNode;
  nodes: readonly TreeNode[];
}) {
  const t = await getTranslations("adminForums.delete");
  const inside = below(nodes, node);
  const gone = new Set([node.id, ...inside.map((entry) => entry.id)]);
  const forums = nodes.filter(
    (entry) => entry.type === "forum" && !gone.has(entry.id),
  );
  const threads = [node, ...inside].reduce(
    (sum, entry) => sum + entry.threadCount,
    0,
  );
  const parent = nodes.find((entry) => entry.id === node.parentId);
  // A forum cannot hold a forum list tab, so the forums of a top-level category cannot move up.
  const stuck =
    node.parentId === null &&
    inside.some(
      (entry) => entry.parentId === node.id && entry.type === "forum",
    );
  return (
    <ConfirmStep
      heading={t("heading")}
      action={deleteNode}
      fields={{ id: node.id, ...(inside.length > 0 && { hasChildren: 1 }) }}
      submit={t("submit", { type: node.type })}
      pendingLabel={t("pending")}
      warning={t("warning", { title: node.title, threads })}
      password
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("threads")}</legend>
        {forums.length > 0 && (
          <div className="space-y-1.5">
            <Label className="min-h-10 text-sm font-normal">
              <input
                type="radio"
                name="threads"
                value="move"
                defaultChecked
                className={radioClass}
              />
              {t("move")}
            </Label>
            <Help>{t("moveHelp")}</Help>
            <select
              name="forumId"
              aria-label={t("moveTo")}
              className={selectClass}
              defaultValue={forums[0]?.id}
            >
              <NodeOptions nodes={forums} />
            </select>
          </div>
        )}
        <Label className="min-h-10 text-sm font-normal">
          <input
            type="radio"
            name="threads"
            value="delete"
            defaultChecked={forums.length === 0}
            className={radioClass}
          />
          {t("remove")}
        </Label>
        <Help>{t("threadsHelp")}</Help>
      </fieldset>
      {inside.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">
            {t("children", { count: inside.length })}
          </legend>
          {stuck ? (
            <Help>{t("moveUpStuck")}</Help>
          ) : (
            <>
              <Label className="min-h-10 text-sm font-normal">
                <input
                  type="radio"
                  name="children"
                  value="moveUp"
                  defaultChecked
                  className={radioClass}
                />
                {parent
                  ? t("moveUp", { title: parent.title })
                  : t("moveUpRoot")}
              </Label>
              <Help>{t("moveUpHelp")}</Help>
            </>
          )}
          <Label className="min-h-10 text-sm font-normal">
            <input
              type="radio"
              name="children"
              value="delete"
              required={stuck}
              className={radioClass}
            />
            {t("removeChildren")}
          </Label>
        </fieldset>
      )}
    </ConfirmStep>
  );
}
