import {
  MemberPreferences,
  preferencesGet,
  SUPPORTED_LANGUAGES,
  watchesListNodes,
  watchesListThreads,
} from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(main)/account/action-form";
import {
  savePreferences,
  stopWatchingForum,
  stopWatchingThread,
} from "@/app/(main)/account/actions";
import {
  cursorOf,
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import { PageLinks } from "@/app/(main)/account/paging";
import { Help, Row, Section, selectClass } from "@/app/(main)/account/section";
import { PendingButton } from "@/components/forum/pending-button";
import { Badge } from "@/components/ui/badge";
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
  const languages = new Intl.DisplayNames(["en"], { type: "language" });
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
                {languages.of(code) ?? code}
              </option>
            ))}
          </select>
        </Row>
      </ActionForm>
    </Section>
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
    noticeOf(searchParams, ["unwatched", "failed"]),
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
            <li
              key={watch.threadId}
              className="flex flex-wrap items-center gap-3 p-4"
            >
              <div className="min-w-0 flex-1 basis-40">
                <Link
                  href={`/threads/${watch.threadId}`}
                  className="block min-h-10 content-center text-sm font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                >
                  {watch.title}
                </Link>
                {watch.email && <Badge variant="outline">{t("email")}</Badge>}
              </div>
              <form action={stopWatchingThread.bind(null, watch.threadId)}>
                <PendingButton variant="outline" className="min-h-10 px-4">
                  {t("stop")}
                  <span className="sr-only"> {watch.title}</span>
                </PendingButton>
              </form>
            </li>
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
  const [t, page] = await Promise.all([
    getTranslations("account.preferences"),
    read(watchesListNodes, { cursor }),
  ]);
  return (
    <Section
      id="forums"
      heading={t("forumsHeading")}
      description={t("forumsDescription")}
    >
      {page.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("forumsEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {page.items.map((watch) => (
            <li
              key={watch.nodeId}
              className="flex flex-wrap items-center gap-3 p-4"
            >
              <div className="min-w-0 flex-1 basis-40">
                <Link
                  href={`/forums/${watch.nodeId}`}
                  className="block min-h-10 content-center text-sm font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                >
                  {watch.title}
                </Link>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {t(`mode.${watch.mode}`)}
                  {watch.email && <Badge variant="outline">{t("email")}</Badge>}
                </p>
              </div>
              <form action={stopWatchingForum.bind(null, watch.nodeId)}>
                <PendingButton variant="outline" className="min-h-10 px-4">
                  {t("stop")}
                  <span className="sr-only"> {watch.title}</span>
                </PendingButton>
              </form>
            </li>
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
