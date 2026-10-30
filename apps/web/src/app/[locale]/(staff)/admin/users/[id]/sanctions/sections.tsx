import {
  bansList,
  Restriction,
  restrictionsList,
  warningsList,
  warningTypesList,
} from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { ItemList } from "@/components/staff/item-list";
import { PagedList } from "@/components/staff/paged-list";
import { Section, selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { ifAllowed } from "../../data";
import {
  addRestriction,
  banMember,
  deleteWarning,
  expireWarning,
  issueWarning,
  liftBan,
  liftRestriction,
  liftThreadBan,
} from "./actions";
import { lookupThreadBans } from "./thread-bans";

type Params = Record<string, string | string[] | undefined>;

const KINDS = Restriction.shape.kind.options;

// Who did it, drawn as a member: the sanctions carry only the id.
async function moderators(ids: number[]) {
  return membersFor(ids.map((id) => ({ id, username: `#${id}` })));
}

// A moment that has passed reads as an age. An expiry is a date to come (or just gone), so
// `future` writes it out in full.
async function When({
  at,
  none,
  future = false,
}: {
  at: string | null;
  none: string;
  future?: boolean;
}) {
  if (!at) return <span>{none}</span>;
  if (!future) return <RelativeTime date={at} />;
  const format = await getFormatter();
  return (
    <time dateTime={at}>
      {format.dateTime(new Date(at), {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  );
}

// The fields every moderation write offers: tell the member, and an optional message to them.
async function NoticeRows() {
  const t = await getTranslations("adminUsers.sanctions");
  return (
    <>
      <Field name="notify" label={t("notify")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="notify"
            defaultChecked
            className="size-5"
          />
          {t("notifyHelp")}
        </label>
      </Field>
      <Field name="message" label={t("message")} htmlFor="sanction-message">
        <Textarea id="sanction-message" name="message" rows={2} />
      </Field>
    </>
  );
}

export async function Warnings({
  userId,
  params,
  mayList,
  mayIssue,
  mayDelete,
  readOnly,
}: {
  userId: number;
  params: Params;
  mayList: boolean;
  mayIssue: boolean;
  mayDelete: boolean;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.sanctions");
  const page = mayList
    ? await ifAllowed(() =>
        call(warningsList, { userId, cursor: cursorFrom(params, "warnings") }),
      )
    : null;
  const who = page
    ? await moderators(page.items.map((i) => i.moderatorId))
    : null;
  const types = mayIssue
    ? ((await ifAllowed(() => call(warningTypesList, {})))?.items ?? [])
    : [];
  // After the reads above, which settle the request: the clock may be read from here.
  const now = Date.now();
  return (
    <>
      {page && who && (
        <PagedList
          items={page.items.map((warning) => ({
            id: warning.id,
            title: warning.reason,
            badges: (
              <>
                <Badge variant="secondary">
                  {t("points", { count: warning.points })}
                </Badge>
                {warning.typeName !== null && (
                  <Badge variant="outline">{warning.typeName}</Badge>
                )}
              </>
            ),
            description: (
              <>
                <When at={warning.createdAt} none="" /> · {t("by")}{" "}
                <UserLink user={who(warning.moderatorId)} /> · {t("expires")}{" "}
                <When at={warning.expiresAt} none={t("never")} future />
              </>
            ),
            actions:
              mayDelete && !readOnly ? (
                <>
                  {(warning.expiresAt === null ||
                    Date.parse(warning.expiresAt) > now) && (
                    <ConfirmStep
                      action={expireWarning}
                      fields={{ id: userId, warningId: warning.id }}
                      summary={t("expireWarning")}
                      warning={t("expireWarningHelp")}
                      reason={t("liftReason")}
                      danger={false}
                    />
                  )}
                  <ConfirmStep
                    action={deleteWarning}
                    fields={{ id: userId, warningId: warning.id }}
                    summary={t("deleteWarning")}
                    warning={t("deleteWarningHelp")}
                    reason={t("liftReason")}
                  />
                </>
              ) : undefined,
          }))}
          paging={{
            path: `/admin/users/${userId}/sanctions`,
            params,
            nextCursor: page.nextCursor,
            cursorParam: "warnings",
          }}
          label={t("warnings")}
          heading={t("warnings")}
          empty={{ title: t("noWarnings") }}
        />
      )}
      {mayIssue && (
        <EditForm action={issueWarning} submit={t("warn")} disabled={readOnly}>
          <input type="hidden" name="id" value={userId} />
          <FieldGroup legend={t("warnHeading")}>
            {types.length > 0 && (
              <Field
                name="typeId"
                label={t("warnType")}
                htmlFor="warn-type"
                help={t("warnTypeHelp")}
              >
                <select
                  id="warn-type"
                  name="typeId"
                  defaultValue=""
                  className={selectClass}
                >
                  <option value="">{t("warnCustom")}</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {t("typeOption", {
                        name: type.name,
                        points: t("points", { count: type.points }),
                        expiry:
                          type.expiryDays === null
                            ? t("never")
                            : t("days", { count: type.expiryDays }),
                        fixed: type.locked ? "yes" : "no",
                      })}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              name="points"
              label={t("pointsLabel")}
              htmlFor="warn-points"
              help={t("pointsHelp")}
            >
              <Input
                id="warn-points"
                name="points"
                type="number"
                inputMode="numeric"
                min={1}
                required={types.length === 0}
              />
            </Field>
            <Field
              name="reason"
              label={t("reason")}
              htmlFor="warn-reason"
              help={types.length > 0 ? t("reasonHelp") : undefined}
            >
              <Textarea
                id="warn-reason"
                name="reason"
                rows={2}
                required={types.length === 0}
              />
            </Field>
            <Field
              name="days"
              label={t("expiresAfter")}
              htmlFor="warn-days"
              help={t("expiresAfterHelp")}
            >
              <Input
                id="warn-days"
                name="days"
                type="number"
                inputMode="numeric"
                min={0}
              />
            </Field>
            <NoticeRows />
          </FieldGroup>
        </EditForm>
      )}
    </>
  );
}

export async function Restrictions({
  userId,
  mayList,
  mayChange,
  readOnly,
}: {
  userId: number;
  mayList: boolean;
  mayChange: boolean;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.sanctions");
  const list = mayList
    ? await ifAllowed(() => call(restrictionsList, { userId }))
    : null;
  return (
    <>
      {list && (
        <ItemList
          label={t("restrictions")}
          heading={t("restrictions")}
          empty={{ title: t("noRestrictions") }}
          items={list.items.map((item) => ({
            id: item.id,
            title: item.reason,
            badges: (
              <>
                <Badge variant={item.active ? "destructive" : "outline"}>
                  {t(`kinds.${item.kind}`)}
                </Badge>
                <Badge variant="secondary">
                  {item.liftedAt
                    ? t("lifted")
                    : item.active
                      ? t("active")
                      : t("expired")}
                </Badge>
              </>
            ),
            description: (
              <>
                <When at={item.createdAt} none="" /> · {t("until")}{" "}
                <When at={item.expiresAt} none={t("never")} future />
              </>
            ),
            actions:
              item.active && mayChange && !readOnly ? (
                <ConfirmStep
                  action={liftRestriction}
                  fields={{ id: userId, restrictionId: item.id }}
                  summary={t("liftRestriction")}
                  reason={t("liftReason")}
                  danger={false}
                />
              ) : undefined,
          }))}
        />
      )}
      {mayChange && (
        <EditForm
          action={addRestriction}
          submit={t("restrict")}
          disabled={readOnly}
        >
          <input type="hidden" name="id" value={userId} />
          <FieldGroup legend={t("restrictHeading")}>
            <Field name="kind" label={t("kind")} htmlFor="restrict-kind">
              <select id="restrict-kind" name="kind" className={selectClass}>
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field name="reason" label={t("reason")} htmlFor="restrict-reason">
              <Textarea id="restrict-reason" name="reason" rows={2} required />
            </Field>
            <Field
              name="days"
              label={t("expiresAfter")}
              htmlFor="restrict-days"
              help={t("restrictDaysHelp")}
            >
              <Input
                id="restrict-days"
                name="days"
                type="number"
                inputMode="numeric"
                min={1}
              />
            </Field>
            <NoticeRows />
          </FieldGroup>
        </EditForm>
      )}
    </>
  );
}

export async function Bans({
  userId,
  params,
  readOnly,
}: {
  userId: number;
  params: Params;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.sanctions");
  const page = await ifAllowed(() =>
    call(bansList, { userId, cursor: cursorFrom(params, "bans") }),
  );
  const who = page
    ? await moderators(page.items.map((i) => i.moderator.id))
    : null;
  return (
    <>
      {page && who && (
        <PagedList
          items={page.items.map((ban) => ({
            id: ban.id,
            title: ban.reason || t("noReason"),
            badges: (
              <Badge
                variant={ban.state === "active" ? "destructive" : "outline"}
              >
                {t(`banStates.${ban.state}`)}
              </Badge>
            ),
            description: (
              <>
                <When at={ban.createdAt} none="" /> · {t("by")}{" "}
                <UserLink user={who(ban.moderator.id)} /> · {t("until")}{" "}
                <When at={ban.expiresAt} none={t("never")} future />
                {ban.liftedAt && (
                  <>
                    {" "}
                    · {t("lifted")} <When at={ban.liftedAt} none="" />
                  </>
                )}
              </>
            ),
            actions:
              ban.state === "active" && !readOnly ? (
                <ConfirmStep
                  action={liftBan}
                  fields={{ id: userId, banId: ban.id }}
                  summary={t("liftBan")}
                  reason={t("liftReason")}
                  danger={false}
                />
              ) : undefined,
          }))}
          paging={{
            path: `/admin/users/${userId}/sanctions`,
            params,
            nextCursor: page.nextCursor,
            cursorParam: "bans",
          }}
          label={t("bans")}
          heading={t("bans")}
          empty={{ title: t("noBans") }}
        />
      )}
      <EditForm action={banMember} submit={t("ban")} disabled={readOnly}>
        <input type="hidden" name="id" value={userId} />
        <FieldGroup legend={t("banHeading")} description={t("banDescription")}>
          <Field name="reason" label={t("reason")} htmlFor="ban-reason">
            <Textarea id="ban-reason" name="reason" rows={2} required />
          </Field>
          <Field
            name="days"
            label={t("banDays")}
            htmlFor="ban-days"
            help={t("banDaysHelp")}
          >
            <Input
              id="ban-days"
              name="days"
              type="number"
              inputMode="numeric"
              min={1}
            />
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input type="checkbox" name="permanent" className="size-5" />
              {t("permanent")}
            </label>
          </Field>
          <NoticeRows />
        </FieldGroup>
      </EditForm>
    </>
  );
}

// Thread bans cannot be listed for a member (the read is per thread): the administrator names
// the thread and sees whether the member is banned in it.
export async function ThreadBans({
  userId,
  thread,
  readOnly,
}: {
  userId: number;
  thread: number | null;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.sanctions");
  const found = thread === null ? null : await lookupThreadBans(thread);
  const mine = found?.items?.find((ban) => ban.userId === userId);
  return (
    <Section heading={t("threadBans")} description={t("threadBansHelp")}>
      <form method="get" className="flex flex-wrap items-end gap-3 p-4">
        <label
          htmlFor="thread-ban-id"
          className="grid gap-1.5 text-xs font-medium"
        >
          {t("threadId")}
          <Input
            id="thread-ban-id"
            name="thread"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={thread ?? ""}
            className="sm:w-40"
          />
        </label>
        <Button type="submit" variant="outline" className="min-h-10 px-4">
          {t("look")}
        </Button>
      </form>
      {thread !== null && (
        <div className="border-t p-4 text-sm">
          {mine ? (
            <div className="space-y-1">
              <p className="[overflow-wrap:anywhere]">{mine.reason}</p>
              <p className="text-xs text-muted-foreground">
                {t("until")}{" "}
                <When at={mine.expiresAt} none={t("never")} future />
              </p>
              {!readOnly && (
                <ConfirmStep
                  action={liftThreadBan}
                  fields={{ id: userId, threadId: thread }}
                  summary={t("liftThreadBan")}
                  reason={t("liftReason")}
                  danger={false}
                />
              )}
            </div>
          ) : (
            <p className="text-muted-foreground [overflow-wrap:anywhere]">
              {found?.refusal
                ? `${t("threadUnavailable")} ${found.refusal}`
                : t("notBannedInThread")}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
