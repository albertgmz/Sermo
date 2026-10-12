import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ListParams, listHref } from "@/components/staff/cursor-list";
import { buttonVariants } from "@/components/ui/button";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { MemberPicker } from "../permissions/member-picker";
import { memberNames } from "./links";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// The id the member filter holds in the address, or null.
export const memberFilterId = (params: ListParams, param: string) =>
  parseId(first(params[param]));

// A member filter for a log: the member chosen (with a link that clears it) or, when none is,
// a search whose matches each link back to this page with the member's id in `param`. The other
// parameters of the page are kept; the cursor is dropped, as a new filter starts a new list.
export async function MemberFilter({
  path,
  params,
  param,
  heading,
}: {
  path: string;
  params: ListParams;
  param: string;
  heading: string;
}) {
  const t = await getTranslations("adminTools.memberFilter");
  const chosen = memberFilterId(params, param);
  const search = `${param}Search`;
  if (chosen !== null) {
    const name = await memberNames([chosen]);
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold">{heading}</span>{" "}
          {t("chosen", { name: name(chosen) })}
        </p>
        <Link
          href={listHref(path, { ...params, [param]: undefined }, "cursor")}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 px-4",
          )}
        >
          {t("clear")}
        </Link>
      </section>
    );
  }
  const keep: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === search || key === "cursor" || key === param) continue;
    const text = first(value);
    if (text) keep[key] = text;
  }
  return (
    <MemberPicker
      query={first(params[search]) || undefined}
      name={search}
      id={`${param}-search`}
      keep={keep}
      heading={heading}
      action={t("choose")}
      href={(userId) =>
        listHref(
          path,
          { ...params, [search]: undefined, [param]: String(userId) },
          "cursor",
        )
      }
    />
  );
}
