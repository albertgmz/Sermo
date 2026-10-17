import { Award, Coins, Eraser, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { type Item, ItemList } from "@/components/staff/item-list";
import { linkClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../registry";
import { MemberLink, memberNames } from "../logs/links";
import { MemberPicker } from "../permissions/member-picker";
import { runOperation, runSpamCleanup } from "./actions";

type Params = PageProps<"/[locale]/admin/tools">["searchParams"];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// The queued operations that take no input, with the permission each needs. A row shows only to
// a holder; the backend checks the permission again when it runs.
const QUEUED = [
  { key: "credits", permission: "credits.adjust", icon: Coins },
  { key: "promotions", permission: "admin.promotions", icon: TrendingUp },
  { key: "awards", permission: "admin.awards", icon: Award },
] as const;

const iconClass = "size-5 text-muted-foreground";

// What an operation does and what it takes, the two lines under its name.
function About({
  description,
  inputs,
}: {
  description: string;
  inputs: string;
}) {
  return (
    <>
      <p className="text-pretty">{description}</p>
      <p>{inputs}</p>
    </>
  );
}

// One row per maintenance operation the viewer holds the permission for.
export async function Maintenance({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const [t, viewer] = await Promise.all([
    getTranslations("adminTools.maintenance"),
    getViewer(),
  ]);
  const holds = (permission: string) =>
    viewer.resolvedPermissions[permission] === true;
  const queued = QUEUED.filter(({ permission }) => holds(permission));
  const spam = holds("member.spamCleanup");
  if (queued.length === 0 && !spam) {
    return (
      <EmptyState title={t("empty")} className="rounded-lg border bg-card" />
    );
  }
  const tasks = hrefFor(viewer, "toolsTasks");
  const chosen = parseId(first(params.spamUser));
  const name =
    chosen === null ? undefined : (await memberNames([chosen]))(chosen);
  const items: Item[] = queued.map(({ key, icon: Icon }) => ({
    id: key,
    icon: <Icon aria-hidden="true" className={iconClass} />,
    title: t(`${key}.heading`),
    description: (
      <About
        description={t(`${key}.description`)}
        inputs={t(`${key}.inputs`)}
      />
    ),
    actions: (
      <ConfirmStep
        action={runOperation}
        fields={{ operation: key }}
        summary={t("run")}
        warning={t(`${key}.warning`)}
        pendingLabel={t("running")}
        submit={t(`${key}.confirm`)}
        danger={false}
      />
    ),
  }));
  if (spam) {
    items.push({
      id: "spam",
      icon: <Eraser aria-hidden="true" className={iconClass} />,
      title: t("spam.heading"),
      description: (
        <About description={t("spam.description")} inputs={t("spam.inputs")} />
      ),
      panel: (
        <div id="spam" className="scroll-mt-4 space-y-3">
          {chosen !== null && name ? (
            <>
              <p className="flex flex-wrap items-center gap-x-3 text-sm">
                {t("spam.chosen", { name })}
                <MemberLink id={chosen} name={name} />
                <Link href="/admin/tools#spam-search" className={linkClass}>
                  {t("spam.change")}
                </Link>
              </p>
              <ConfirmStep
                action={runSpamCleanup}
                fields={{ userId: String(chosen) }}
                summary={t("run")}
                warning={t("spam.warning", { name })}
                pendingLabel={t("running")}
                submit={t("spam.confirm")}
                danger={false}
              >
                <div className="space-y-1">
                  <label htmlFor="spam-reason" className="text-sm font-medium">
                    {t("spam.reason")}
                  </label>
                  <Input
                    id="spam-reason"
                    name="reason"
                    aria-describedby="spam-reason-help"
                  />
                  <p
                    id="spam-reason-help"
                    className="text-xs text-muted-foreground"
                  >
                    {t("spam.reasonHelp")}
                  </p>
                </div>
              </ConfirmStep>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("spam.pick")}</p>
          )}
        </div>
      ),
    });
  }
  return (
    <div className="space-y-4">
      <ItemList
        label={t("heading")}
        items={items}
        empty={{ title: t("empty") }}
      />
      {spam && (
        <MemberPicker
          id="spam-search"
          name="spamSearch"
          query={first(params.spamSearch) || undefined}
          heading={t("spam.search")}
          action={t("spam.choose")}
          href={(userId) => `/admin/tools?spamUser=${userId}#spam`}
        />
      )}
      {tasks && (
        <Link href={tasks} className={linkClass}>
          {t("background")}
        </Link>
      )}
    </div>
  );
}
