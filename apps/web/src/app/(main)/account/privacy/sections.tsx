import {
  MemberPreferences,
  preferencesGet,
  usersListIgnored,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(main)/account/action-form";
import { savePrivacy, stopIgnoring } from "@/app/(main)/account/actions";
import {
  cursorOf,
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import { PageLinks } from "@/app/(main)/account/paging";
import { Help, Row, Section } from "@/app/(main)/account/section";
import { PendingButton } from "@/components/forum/pending-button";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";

const PATH = "/account/privacy";

function Choices({
  name,
  legend,
  options,
  current,
  explain,
}: {
  name: string;
  legend: string;
  options: readonly string[];
  current: string;
  explain: (option: string) => { label: string; help: string };
}) {
  return (
    <Row label={legend}>
      <fieldset className="min-w-0 space-y-1">
        <legend className="sr-only">{legend}</legend>
        {options.map((option) => {
          const { label, help } = explain(option);
          return (
            <label
              key={option}
              className="flex min-h-10 items-start gap-3 py-2"
            >
              <input
                type="radio"
                name={name}
                value={option}
                defaultChecked={option === current}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <Help>{help}</Help>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Row>
  );
}

export async function PrivacySection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, preferences, notice] = await Promise.all([
    getTranslations("account.privacy"),
    read(preferencesGet, {}),
    noticeOf(searchParams, ["privacy"]),
  ]);
  const { shape } = MemberPreferences;
  return (
    <Section
      id="privacy"
      heading={t("sectionHeading")}
      description={t("sectionDescription")}
    >
      <Notice notice={notice} />
      <ActionForm action={savePrivacy} submit={t("submit")}>
        <Choices
          name="profileViewPrivacy"
          legend={t("viewLegend")}
          options={shape.profileViewPrivacy.options}
          current={preferences.profileViewPrivacy}
          explain={(option) => ({
            label: t(`view.${option as "everyone"}.label`),
            help: t(`view.${option as "everyone"}.help`),
          })}
        />
        <Choices
          name="profilePostPrivacy"
          legend={t("postLegend")}
          options={shape.profilePostPrivacy.options}
          current={preferences.profilePostPrivacy}
          explain={(option) => ({
            label: t(`post.${option as "members"}.label`),
            help: t(`post.${option as "members"}.help`),
          })}
        />
      </ActionForm>
    </Section>
  );
}

export async function IgnoredSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const cursor = cursorOf(params.ignored);
  const [t, page, notice] = await Promise.all([
    getTranslations("account.privacy"),
    read(usersListIgnored, { cursor }),
    noticeOf(searchParams, ["unignored"], ["ignored"]),
  ]);
  const member = await membersFor(page.items.map((entry) => entry.user));
  return (
    <Section
      id="ignored"
      heading={t("ignoredHeading")}
      description={t("ignoredDescription")}
    >
      <Notice notice={notice} />
      {page.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("ignoredEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {page.items.map((entry) => {
            const view = member(entry.user.id);
            return (
              <li
                key={entry.user.id}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                <UserAvatar user={view} size="lg" link={false} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm">
                    <UserLink user={view} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("since")} <RelativeTime date={entry.followedAt} />
                  </p>
                </div>
                <form action={stopIgnoring.bind(null, entry.user.id)}>
                  <PendingButton variant="outline" className="min-h-10 px-4">
                    {t("stop")}
                    <span className="sr-only"> {view.username}</span>
                  </PendingButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <PageLinks
        path={PATH}
        param="ignored"
        hash="ignored"
        cursor={cursor}
        next={page.nextCursor}
      />
    </Section>
  );
}
