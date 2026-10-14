import {
  MemberPreferences,
  preferencesGet,
  SUPPORTED_LANGUAGES,
  watchesListNodes,
  watchesListThreads,
} from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ActionForm } from "@/app/[locale]/(main)/account/action-form";
import {
  savePreferences,
  stopWatchingForum,
  stopWatchingThread,
} from "@/app/[locale]/(main)/account/actions";
import {
  cursorOf,
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/[locale]/(main)/account/notice";
import { PageLinks } from "@/app/[locale]/(main)/account/paging";
import { PendingButton } from "@/components/forum/pending-button";
import { Help, Row, Section, selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { languageName } from "@/lib/language-name";
import { read } from "@/lib/sermo/client";

const PATH = "/account/preferences";

const WATCH_FIELDS = [
  ["watchOnCreate", "create"],
  ["watchOnReply", "reply"],
] as const;

export async function PreferencesSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, preferences, notice] = await Promise.all([
    getTranslations("account.preferences"),
    read(preferencesGet, {}),
    noticeOf(searchParams, ["preferences"]),
  ]);
  const watchModes = MemberPreferences.shape.watchOnCreate.options;
  return (
    <Section
      id="preferences"
      heading={t("sectionHeading")}
      description={t("sectionDescription")}
    >
      <Notice notice={notice} />
      <ActionForm action={savePreferences} submit={t("submit")}>
        {WATCH_FIELDS.map(([name, key]) => (
          <Row key={name} label={t(`${key}Label`)} htmlFor={`pref-${name}`}>
            <select
              id={`pref-${name}`}
              name={name}
              defaultValue={preferences[name]}
              className={selectClass}
            >
              {watchModes.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`watch.${mode}`)}
                </option>
              ))}
            </select>
            <Help>{t(`${key}Help`)}</Help>
          </Row>
        ))}
        <Row label={t("languageLabel")} htmlFor="pref-language">
          <select
            id="pref-language"
            name="language"
            defaultValue={preferences.language ?? ""}
            className={selectClass}
          >
            <option value="">{t("languageDefault")}</option>
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {languageName(code)}
              </option>
            ))}
          </select>
        </Row>
      </ActionForm>
    </Section>
  );
}

// One watched thread or forum: its title as a link, a line under it, and the button that stops
// the watch.
function WatchRow({
  href,
  title,
  stop,
  action,
  children,
}: {
  href: string;
  title: string;
  stop: string;
  action: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 basis-40">
        <Link
          href={href}
          className="block min-h-10 content-center text-sm font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline"
        >
          {title}
        </Link>
        {children}
      </div>
      <form action={action}>
        <PendingButton variant="outline" className="min-h-10 px-4">
          {stop}
          <span className="sr-only"> {title}</span>
        </PendingButton>
      </form>
    </li>
  );
}

export async function ThreadWatches({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cursor = cursorOf((await searchParams).threads);
  const [t, page, notice] = await Promise.all([
    getTranslations("account.preferences"),
    read(watchesListThreads, { cursor }),
    noticeOf(searchParams, ["threadUnwatched"], ["threads"]),
  ]);
  return (
    <Section
      id="threads"
      heading={t("threadsHeading")}
      description={t("threadsDescription")}
    >
      <Notice notice={notice} />
      {page.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("threadsEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {page.items.map((watch) => (
            <WatchRow
              key={watch.threadId}
              href={`/threads/${watch.threadId}`}
              title={watch.title}
              stop={t("stop")}
              action={stopWatchingThread.bind(null, watch.threadId)}
            >
              {watch.email && <Badge variant="outline">{t("email")}</Badge>}
            </WatchRow>
          ))}
        </ul>
      )}
      <PageLinks
        path={PATH}
        param="threads"
        hash="threads"
        cursor={cursor}
        next={page.nextCursor}
      />
    </Section>
  );
}

export async function ForumWatches({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cursor = cursorOf((await searchParams).forums);
  const [t, page, notice] = await Promise.all([
    getTranslations("account.preferences"),
    read(watchesListNodes, { cursor }),
    noticeOf(searchParams, ["forumUnwatched"], ["forums"]),
  ]);
  return (
    <Section
      id="forums"
      heading={t("forumsHeading")}
      description={t("forumsDescription")}
    >
      <Notice notice={notice} />
      {page.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("forumsEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {page.items.map((watch) => (
            <WatchRow
              key={watch.nodeId}
              href={`/forums/${watch.nodeId}`}
              title={watch.title}
              stop={t("stop")}
              action={stopWatchingForum.bind(null, watch.nodeId)}
            >
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t(`mode.${watch.mode}`)}
                {watch.email && <Badge variant="outline">{t("email")}</Badge>}
              </p>
            </WatchRow>
          ))}
        </ul>
      )}
      <PageLinks
        path={PATH}
        param="forums"
        hash="forums"
        cursor={cursor}
        next={page.nextCursor}
      />
    </Section>
  );
}
