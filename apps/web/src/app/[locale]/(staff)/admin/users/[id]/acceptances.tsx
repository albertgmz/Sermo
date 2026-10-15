import { usersAdminAcceptances } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { Section } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { ifAllowed } from "../data";

const KINDS = ["terms", "rules"] as const;

// The versions of the terms and the rules the member accepted, with the date and the address, and
// whether they are up to date. Read-only. Not drawn for a viewer the backend refuses.
export async function Acceptances({ userId }: { userId: number }) {
  const [t, format, view] = await Promise.all([
    getTranslations("adminUsers.acceptances"),
    getFormatter(),
    ifAllowed(() => read(usersAdminAcceptances, { userId })),
  ]);
  if (!view) return null;
  const when = (at: string) =>
    format.dateTime(new Date(at), { dateStyle: "medium", timeStyle: "short" });
  return (
    <Section heading={t("heading")} description={t("description")}>
      <ul className="divide-y">
        {KINDS.map((kind) => {
          const current = view.current[kind];
          const mine = view.items.filter((item) => item.kind === kind);
          // Newest first: the backend lists the latest acceptance of each kind first.
          const newest = mine[0];
          return (
            <li key={kind} className="space-y-2 p-4 text-sm">
              <p className="font-medium">{t(kind)}</p>
              <p className="text-muted-foreground">
                {current === null
                  ? t("notPublished")
                  : t("current", { version: current })}
              </p>
              {current !== null && (
                <p>
                  {newest === undefined
                    ? t("neverAccepted")
                    : newest.version >= current
                      ? t("upToDate")
                      : t("outOfDate")}
                </p>
              )}
              {mine.length > 0 && (
                <ul aria-label={t(kind)} className="space-y-1">
                  {mine.map((item) => (
                    <li
                      key={item.version}
                      className="flex flex-wrap gap-x-3 [overflow-wrap:anywhere]"
                    >
                      <span className="font-medium">
                        {t("version", { version: item.version })}
                      </span>
                      <time dateTime={item.acceptedAt}>
                        {when(item.acceptedAt)}
                      </time>
                      <span className="text-muted-foreground">
                        {t("address")}: {item.ip ?? t("noAddress")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
