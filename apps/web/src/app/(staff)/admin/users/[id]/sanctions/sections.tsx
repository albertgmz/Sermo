import {
  bansList,
  restrictionsList,
  threadBansList,
  warningsList,
} from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { UserLink } from "@/components/forum/user-link";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Section, selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { ifAllowed } from "../../data";
import { InlineAction } from "../../inline-action";
import {
  addRestriction,
  banMember,
  issueWarning,
  liftBan,
  liftRestriction,
  liftThreadBan,
} from "./actions";

type Params = Record<string, string | string[] | undefined>;

const KINDS = ["posting", "conversations", "profile_posts"] as const;

// Who did it, drawn as a member: the sanctions carry only the id.
async function moderators(ids: number[]) {
  return membersFor(ids.map((id) => ({ id, username: `#${id}` })));
}

async function When({ at, none }: { at: string | null; none: string }) {
  const format = await getFormatter();
  return at ? (
    <time dateTime={at}>
      {format.dateTime(new Date(at), {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  ) : (
    <span>{none}</span>
  );
}

// The fields every moderation write offers: tell the member, and an optional message to them.
async function NoticeRows() {
  const t = await getTranslations("adminUsers.sanctions");
  return (
    <>
      <FieldRow name="notify" label={t("notify")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="notify"
            defaultChecked
            className="size-5"
          />
          {t("notifyHelp")}
        </label>
      </FieldRow>
      <FieldRow name="message" label={t("message")} htmlFor="sanction-message">
        <Textarea
          id="sanction-message"
          name="message"
          rows={2}
          maxLength={1000}
        />
      </FieldRow>
    </>
  );
}

export async function Warnings({
  userId,
  params,
  mayList,
  mayIssue,
  readOnly,
}: {
  userId: number;
  params: Params;
  mayList: boolean;
  mayIssue: boolean;
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
  return (
    <>
      {page && who && (
        <CursorList
          items={page.items}
          nextCursor={page.nextCursor}
          path={`/admin/users/${userId}/sanctions`}
          params={params}
          cursorParam="warnings"
          itemKey={(warning) => warning.id}
          label={t("warnings")}
          head={
            <div className="border-b p-4">
              <h2 className="text-sm font-semibold">{t("warnings")}</h2>
            </div>
          }
          empty={{ title: t("noWarnings") }}
          render={(warning) => (
            <div className="space-y-1 p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {t("points", { count: warning.points })}
                </Badge>
                <span className="[overflow-wrap:anywhere]">
                  {warning.reason}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                <When at={warning.createdAt} none="" /> · {t("by")}{" "}
                <UserLink
                  user={who(warning.moderatorId)}
                  className="inline-flex min-h-10 items-center"
                />{" "}
                · {t("expires")}{" "}
                <When at={warning.expiresAt} none={t("never")} />
              </p>
            </div>
          )}
        />
      )}
      {mayIssue && (
        <FormRows
          action={issueWarning}
          heading={t("warnHeading")}
          submit={t("warn")}
          disabled={readOnly}
        >
          <input type="hidden" name="id" value={userId} />
          <FieldRow
            name="points"
            label={t("pointsLabel")}
            htmlFor="warn-points"
          >
            <Input
              id="warn-points"
              name="points"
              type="number"
              inputMode="numeric"
              min={1}
              required
            />
          </FieldRow>
          <FieldRow name="reason" label={t("reason")} htmlFor="warn-reason">
            <Textarea
              id="warn-reason"
              name="reason"
              rows={2}
              required
              maxLength={5000}
            />
          </FieldRow>
          <FieldRow
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
              min={1}
            />
          </FieldRow>
          <NoticeRows />
        </FormRows>
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
        <Section heading={t("restrictions")}>
          {list.items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("noRestrictions")}
            </p>
          ) : (
            <ul className="divide-y">
              {list.items.map((item) => (
                <li key={item.id} className="space-y-1 p-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
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
                    <span className="[overflow-wrap:anywhere]">
                      {item.reason}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <When at={item.createdAt} none="" /> · {t("until")}{" "}
                    <When at={item.expiresAt} none={t("never")} />
                  </p>
                  {item.active && mayChange && !readOnly && (
                    <InlineAction
                      action={liftRestriction}
                      fields={{ id: userId, restrictionId: item.id }}
                      label={t("liftRestriction")}
                      reason={t("liftReason")}
                      danger={false}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {mayChange && (
        <FormRows
          action={addRestriction}
          heading={t("restrictHeading")}
          submit={t("restrict")}
          disabled={readOnly}
        >
          <input type="hidden" name="id" value={userId} />
          <FieldRow name="kind" label={t("kind")} htmlFor="restrict-kind">
            <select id="restrict-kind" name="kind" className={selectClass}>
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kinds.${kind}`)}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow name="reason" label={t("reason")} htmlFor="restrict-reason">
            <Textarea
              id="restrict-reason"
              name="reason"
              rows={2}
              required
              maxLength={5000}
            />
          </FieldRow>
          <FieldRow
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
          </FieldRow>
          <NoticeRows />
        </FormRows>
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
        <CursorList
          items={page.items}
          nextCursor={page.nextCursor}
          path={`/admin/users/${userId}/sanctions`}
          params={params}
          cursorParam="bans"
          itemKey={(ban) => ban.id}
          label={t("bans")}
          head={
            <div className="border-b p-4">
              <h2 className="text-sm font-semibold">{t("bans")}</h2>
            </div>
          }
          empty={{ title: t("noBans") }}
          render={(ban) => (
            <div className="space-y-1 p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={ban.state === "active" ? "destructive" : "outline"}
                >
                  {t(`banStates.${ban.state}`)}
                </Badge>
                <span className="[overflow-wrap:anywhere]">{ban.reason}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                <When at={ban.createdAt} none="" /> · {t("by")}{" "}
                <UserLink
                  user={who(ban.moderator.id)}
                  className="inline-flex min-h-10 items-center"
                />{" "}
                · {t("until")} <When at={ban.expiresAt} none={t("never")} />
                {ban.liftedAt && (
                  <>
                    {" "}
                    · {t("lifted")} <When at={ban.liftedAt} none="" />
                  </>
                )}
              </p>
              {ban.state === "active" && !readOnly && (
                <InlineAction
                  action={liftBan}
                  fields={{ id: userId, banId: ban.id }}
                  label={t("liftBan")}
                  reason={t("liftReason")}
                  danger={false}
                />
              )}
            </div>
          )}
        />
      )}
      <FormRows
        action={banMember}
        heading={t("banHeading")}
        description={t("banDescription")}
        submit={t("ban")}
        disabled={readOnly}
      >
        <input type="hidden" name="id" value={userId} />
        <FieldRow name="reason" label={t("reason")} htmlFor="ban-reason">
          <Textarea
            id="ban-reason"
            name="reason"
            rows={2}
            required
            maxLength={5000}
          />
        </FieldRow>
        <FieldRow
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
        </FieldRow>
        <NoticeRows />
      </FormRows>
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
  const found =
    thread === null
      ? null
      : await ifAllowed(() => call(threadBansList, { threadId: thread }));
  const mine = found?.items.find((ban) => ban.userId === userId);
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
                {t("until")} <When at={mine.expiresAt} none={t("never")} />
              </p>
              {!readOnly && (
                <InlineAction
                  action={liftThreadBan}
                  fields={{ id: userId, threadId: thread }}
                  label={t("liftThreadBan")}
                  reason={t("liftReason")}
                  danger={false}
                />
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {found ? t("notBannedInThread") : t("threadUnavailable")}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
