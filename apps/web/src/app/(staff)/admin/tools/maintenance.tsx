import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { linkClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../registry";
import { MemberLink, memberNames } from "../logs/links";
import { MemberPicker } from "../permissions/member-picker";
import { runOperation, runSpamCleanup } from "./actions";
import { OperationForm } from "./operation-form";

type Params = PageProps<"/admin/tools">["searchParams"];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// The queued operations that take no input, with the permission each needs. A card shows only to
// a holder; the backend checks the permission again when it runs.
const QUEUED = [
  { key: "credits", permission: "credits.adjust" },
  { key: "promotions", permission: "admin.promotions" },
  { key: "awards", permission: "admin.awards" },
] as const;

function Card({
  id,
  heading,
  description,
  inputs,
  children,
}: {
  id: string;
  heading: string;
  description: string;
  inputs: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="min-w-0 scroll-mt-4 space-y-3 rounded-lg border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{heading}</h2>
        <p className="text-sm text-pretty">{description}</p>
        <p className="text-xs text-muted-foreground">{inputs}</p>
      </div>
      {children}
    </section>
  );
}

// One card per maintenance operation the viewer holds the permission for.
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
  return (
    <div className="space-y-4">
      {queued.map(({ key }) => (
        <Card
          key={key}
          id={key}
          heading={t(`${key}.heading`)}
          description={t(`${key}.description`)}
          inputs={t(`${key}.inputs`)}
        >
          <OperationForm
            action={runOperation}
            fields={{ operation: key }}
            summary={t("run")}
            warning={t(`${key}.warning`)}
            submit={t(`${key}.confirm`)}
          />
        </Card>
      ))}
      {spam && (
        <>
          <Card
            id="spam"
            heading={t("spam.heading")}
            description={t("spam.description")}
            inputs={t("spam.inputs")}
          >
            {chosen !== null && name ? (
              <>
                <p className="flex flex-wrap items-center gap-x-3 text-sm">
                  {t("spam.chosen", { name })}
                  <MemberLink id={chosen} name={name} />
                  <Link href="/admin/tools#spam-search" className={linkClass}>
                    {t("spam.change")}
                  </Link>
                </p>
                <OperationForm
                  action={runSpamCleanup}
                  fields={{ userId: String(chosen) }}
                  summary={t("run")}
                  warning={t("spam.warning", { name })}
                  submit={t("spam.confirm")}
                >
                  <div className="space-y-1">
                    <label
                      htmlFor="spam-reason"
                      className="text-sm font-medium"
                    >
                      {t("spam.reason")}
                    </label>
                    <Input
                      id="spam-reason"
                      name="reason"
                      maxLength={5000}
                      aria-describedby="spam-reason-help"
                    />
                    <p
                      id="spam-reason-help"
                      className="text-xs text-muted-foreground"
                    >
                      {t("spam.reasonHelp")}
                    </p>
                  </div>
                </OperationForm>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("spam.pick")}</p>
            )}
          </Card>
          <MemberPicker
            id="spam-search"
            name="spamSearch"
            query={first(params.spamSearch) || undefined}
            heading={t("spam.search")}
            action={t("spam.choose")}
            href={(userId) => `/admin/tools?spamUser=${userId}#spam`}
          />
        </>
      )}
      {tasks && (
        <Link href={tasks} className={linkClass}>
          {t("background")}
        </Link>
      )}
    </div>
  );
}
