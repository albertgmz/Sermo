import { nodesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ListParams } from "@/components/staff/cursor-list";
import { selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { call } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { moderatedForums } from "./forum-scope";

const field = "grid min-w-0 gap-1.5 text-xs font-medium";

export const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// The forums the viewer may see, for a forum filter: categories hold no content, so only forums.
// With `moderated`, for a queue of what a moderator may act on: only the forums the viewer
// moderates, since the backend refuses a filter on any other.
export async function forumOptions({ moderated = false } = {}) {
  const [{ items }, viewer] = await Promise.all([
    call(nodesList, {}),
    moderated ? getViewer() : null,
  ]);
  return (viewer ? moderatedForums(items, viewer.staff) : items)
    .filter((node) => node.type === "forum")
    .map((node) => ({
      value: String(node.id),
      label: `${"  ".repeat(node.depth)}${node.title}`,
    }));
}

// The filters of a queue: a GET form, so the address holds the choice and the list starts from
// its first page. `states` shows a state select (its options are the values the read takes);
// `stateDefault` is what the select shows while the address has no `state` yet.
export async function FilterBar({
  path,
  params,
  states,
  forums,
  stateDefault,
}: {
  path: string;
  params: ListParams;
  states?: readonly string[];
  forums: { value: string; label: string }[];
  stateDefault?: string;
}) {
  const [t, state] = await Promise.all([
    getTranslations("moderation.common"),
    getTranslations("moderation.common.state"),
  ]);
  const chosenState =
    params.state === undefined ? (stateDefault ?? "") : first(params.state);
  return (
    <form method="get" action={path} aria-label={t("filters")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {states && (
          <label className={field}>
            {t("stateFilter")}
            <select
              name="state"
              defaultValue={chosenState}
              className={selectClass}
            >
              <option value="">{t("all")}</option>
              {states.map((value) => (
                <option key={value} value={value}>
                  {state(value as "open")}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={field}>
          {t("forumFilter")}
          <select
            name="nodeId"
            defaultValue={first(params.nodeId)}
            className={selectClass}
          >
            <option value="">{t("all")}</option>
            {forums.map((forum) => (
              <option key={forum.value} value={forum.value}>
                {forum.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-10 px-4">
          {t("apply")}
        </Button>
        <Link
          href={path}
          className="inline-flex min-h-10 items-center px-2 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("reset")}
        </Link>
      </div>
    </form>
  );
}
