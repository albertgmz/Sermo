import type { nodesList } from "@sermo/core/contracts";
import type * as z from "zod";

export type TreeNode = z.output<typeof nodesList.output>["items"][number];

// The options of a select over the node tree, in the tree's own order with the depth shown as a
// dash prefix. `without` leaves one node out (the node being edited cannot be its own parent).
export function NodeOptions({
  nodes,
  without,
}: {
  nodes: readonly TreeNode[];
  without?: number;
}) {
  return nodes
    .filter((node) => node.id !== without)
    .map((node) => (
      <option key={node.id} value={node.id}>
        {"— ".repeat(node.depth)}
        {node.title}
      </option>
    ));
}
