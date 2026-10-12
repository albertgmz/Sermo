import { usersSearch } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MemberRow } from "@/components/forum/member-row";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

// Finds a member by the start of their username and lists the matches, each with a link.
//
// Props
//   query     What was typed (the page's own parameter), or undefined for none yet.
//   name      Name of the parameter that holds it. Default "q".
//   keep      Other parameters of the page to carry on the search (hidden fields).
//   href      Where a match leads, by member id.
//   action    The link's label.
//   heading   The panel's heading; id gives the field an id of its own.
export async function MemberPicker({
  query,
  name = "q",
  keep = {},
  href,
  action,
  heading,
  id = "member-search",
  children,
}: {
  query: string | undefined;
  name?: string;
  keep?: Record<string, string>;
  href: (userId: number) => string;
  action: string;
  heading: string;
  id?: string;
  children?: (member: { id: number; username: string }) => React.ReactNode;
}) {
  const t = await getTranslations("adminGroups.memberPicker");
  const typed = query?.trim() ?? "";
  const found = typed
    ? (await call(usersSearch, { prefix: typed.slice(0, 32), limit: 25 })).items
    : null;
  const member = found ? await membersFor(found) : null;
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="space-y-3 border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        <form className="flex flex-wrap items-end gap-2">
          {Object.entries(keep).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
            <label htmlFor={id} className="text-sm font-medium">
              {t("label")}
            </label>
            <Input id={id} name={name} defaultValue={typed} required />
          </div>
          <Button type="submit" className="min-h-10 px-4">
            {t("search")}
          </Button>
        </form>
      </div>
      {found &&
        (found.length > 0 ? (
          <ul aria-label={heading} className="divide-y">
            {found.map((item) => (
              <li key={item.id}>
                {member && (
                  <MemberRow user={member(item.id)}>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link
                        href={href(item.id)}
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "min-h-10 px-4",
                        )}
                      >
                        {action}
                      </Link>
                      {children?.(item)}
                    </div>
                  </MemberRow>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {t("none", { query: typed })}
          </p>
        ))}
    </section>
  );
}
