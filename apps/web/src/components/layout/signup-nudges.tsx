"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { consentSettled } from "@/components/layout/consent-library";
import { PromptCard } from "@/components/layout/prompt-card";
import { loadedCode } from "@/components/ui/lazy-popup-gate";
import { GRACE_MS } from "@/lib/app-prompts";
import { useInviteOnScreen } from "@/lib/invites-in-view";
import { joinHost } from "@/lib/join-host";
import { hostJoinWindow, type JoinAsk, loginHref } from "@/lib/join-window";
import { SEARCH_VISIT_KEY, SNOOZE_KEY } from "@/lib/signup-nudge-keys";
import {
  cardShown,
  DELAY_MS,
  readSnooze,
  SEARCH_VISIT,
  scrolledEnough,
  searchVisit,
} from "@/lib/signup-nudges";
import { readStored } from "@/lib/stored";

// A guest's invitations to create an account that float over the page (`lib/signup-nudges.ts`
// decides which and when): the card for a visit that came from a search engine, and the sign-up
// window that the actions only members can take open (`JoinLink`). Drawn only for guests, and only
// where registration is open. The window's code comes with the first reach for such an action,
// through the site's lazy-popup path (`lib/join-host.ts`): when it cannot be fetched the guest goes
// to the log-in page instead. A move to another address closes the window (Back while it is open).

const loadJoinWindow = () =>
  import("@/components/layout/join-window").then((module) => ({
    default: module.JoinWindow,
  }));

export function SignupNudges({
  appName,
  icon,
}: {
  appName: string;
  icon: React.ReactNode;
}) {
  const t = useTranslations("layout.signupNudges");
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const [visit, setVisit] = useState<{
    search: boolean;
    snoozedAt: number | null;
  } | null>(null);
  const [settled, setSettled] = useState(false);
  const [waited, setWaited] = useState(false);
  const [ask, setAsk] = useState<JoinAsk | null>(null);
  const [windowOpen, setWindowOpen] = useState(false);
  const inviteInView = useInviteOnScreen();

  // Where the visit came from, kept for the rest of it, and when the card was last put off.
  useEffect(() => {
    const stored = readStored(() => sessionStorage, SEARCH_VISIT_KEY);
    const search = searchVisit(
      stored,
      document.referrer,
      window.location.hostname,
    );
    if (search && stored !== SEARCH_VISIT)
      try {
        sessionStorage.setItem(SEARCH_VISIT_KEY, SEARCH_VISIT);
      } catch {}
    setVisit({
      search,
      snoozedAt: readSnooze(readStored(() => localStorage, SNOOZE_KEY)),
    });
  }, []);

  // The cookie banner first, then a moment.
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    consentSettled().then(() => {
      timer = setTimeout(() => {
        if (live) setSettled(true);
      }, GRACE_MS);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  // A few seconds on the site, or some scrolling, whichever comes first.
  const search = visit?.search ?? false;
  useEffect(() => {
    if (!search || waited) return;
    const done = () => setWaited(true);
    const timer = setTimeout(done, DELAY_MS);
    const onScroll = () => {
      if (scrolledEnough(window.scrollY, window.innerHeight)) done();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [search, waited]);

  // The actions only members can take open the window from now on.
  useEffect(
    () =>
      hostJoinWindow(
        joinHost(loadJoinWindow, {
          show: (next) => {
            setAsk(next);
            setWindowOpen(true);
          },
          follow: (href) => window.location.assign(href),
        }),
      ),
    [],
  );

  // Another page or another page of the same thread (Back while the window is open): it closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new address is what closes it
  useEffect(() => setWindowOpen(false), [pathname, query]);

  const shown =
    visit !== null &&
    cardShown({
      consentSettled: settled,
      searchVisit: visit.search,
      snoozedAt: visit.snoozedAt,
      now: Date.now(),
      waited,
      windowOpen,
      inviteInView,
    });
  const putOff = () => {
    const now = Date.now();
    try {
      localStorage.setItem(SNOOZE_KEY, String(now));
    } catch {}
    setVisit({ search: true, snoozedAt: now });
  };

  const JoinWindow = ask && loadedCode(loadJoinWindow);
  return (
    <>
      {shown && (
        <PromptCard
          icon={icon}
          title={t("card.title", { site: appName })}
          action={{ label: t("register"), href: "/register" }}
          secondary={{ label: t("login"), href: loginHref(pathname) }}
          dismiss={{ label: t("notNow"), onClick: putOff }}
          // The +18 page has its own ways in.
          className="[body:has([data-adult-page])_&]:hidden"
        >
          {t("card.body")}
        </PromptCard>
      )}
      {ask && JoinWindow && (
        <JoinWindow
          ask={ask}
          open={windowOpen}
          onOpenChange={setWindowOpen}
          appName={appName}
          icon={icon}
        />
      )}
    </>
  );
}
