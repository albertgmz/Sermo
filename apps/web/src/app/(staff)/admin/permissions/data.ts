import "server-only";

import {
  permissionsDefinitions,
  type permissionsList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import type { MatrixValue } from "@/components/staff/permission-entries";
import type { MatrixPermission } from "@/components/staff/permission-matrix";
import { read } from "@/lib/sermo/client";

export type Definition = z.output<
  typeof permissionsDefinitions.output
>["items"][number];

// Every permission the backend registers, once per request.
export const getDefinitions = cache(
  async (): Promise<Definition[]> =>
    (await read(permissionsDefinitions, {})).items,
);

// The entries of a target by permission id, as `PermissionMatrix` takes them.
export function entriesOf(
  set: z.output<typeof permissionsList.output>,
): Record<string, MatrixValue> {
  return Object.fromEntries(
    set.entries.map((entry) => [entry.permission, entry.value]),
  );
}

// The definitions as the matrix shows them. `nodeOnly` keeps the permissions of forum scope (for
// the entries set on one forum). `builtin` is the key of the built-in group being shown, whose
// starting default is noted beside each permission.
export async function matrixPermissions(
  definitions: readonly Definition[],
  {
    nodeOnly = false,
    builtin = null,
  }: { nodeOnly?: boolean; builtin?: string | null } = {},
): Promise<MatrixPermission[]> {
  const t = await getTranslations("adminGroups.matrix");
  return definitions
    .filter((definition) => !nodeOnly || definition.scope === "node")
    .map((definition) => {
      const start = builtin ? definition.defaults[builtin] : undefined;
      return {
        id: definition.id,
        type: definition.type,
        scope: definition.scope,
        title: definition.title,
        help: definition.help,
        category: definition.category,
        categoryTitle: definition.categoryTitle,
        unit: definition.unit,
        initial:
          start === undefined
            ? null
            : typeof start === "number"
              ? start === -1
                ? t("unlimited")
                : String(start)
              : start === "allow"
                ? t("allow")
                : t("never"),
      };
    });
}
