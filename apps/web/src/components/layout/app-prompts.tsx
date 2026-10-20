"use client";

import { Share } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { consentSettled } from "@/components/layout/consent-library";
import { PromptCard } from "@/components/layout/prompt-card";
import {
  type Card,
  cardToShow,
  type InstallOffer,
  installOffer,
  PROMPTS_KEY,
  readSnoozes,
  readVisit,
  VISIT_KEY,
  type Visit,
} from "@/lib/app-prompts";
import { promptInstall, useInstallState } from "@/lib/install-prompt";
import {
  currentAvailability,
  currentPermission,
  currentPlatform,
  turnOnPush,
} from "@/lib/push-client";

// The cards that offer the app and notifications (`lib/app-prompts.ts` decides which and when). They
// wait for the cookie banner, count the pages of the visit, and are decided again on every page.
// Installing goes through the browser's own dialog where there is one; iOS Safari has none and is
// shown the steps.

function readStored(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function snoozeCard(card: Card, now: number) {
  try {
    const snoozes = readSnoozes(localStorage.getItem(PROMPTS_KEY));
    localStorage.setItem(
      PROMPTS_KEY,
      JSON.stringify({ ...snoozes, [card]: now }),
    );
  } catch {}
}

function saveVisit(visit: Visit) {
  try {
    sessionStorage.setItem(VISIT_KEY, JSON.stringify(visit));
  } catch {}
}

const SETTINGS_PATH = "/account/notifications";

const loadVisit = () => readVisit(readStored(() => sessionStorage, VISIT_KEY));

export function AppPrompts({
  member,
  pushKey,
  appName,
  icon,
}: {
  member: { createdAt: string } | null;
  pushKey: string | null;
  appName: string;
  icon: React.ReactNode;
}) {
  const t = useTranslations("layout.appPrompts");
  const pathname = usePathname();
  const install = useInstallState();
  const [settled, setSettled] = useState(false);
  const [shown, setShown] = useState<{
    card: Card;
    offer: InstallOffer;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    consentSettled().then(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, []);

  // One page more in this visit, then the card for this page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what counts
  useEffect(() => {
    const visit = loadVisit();
    saveVisit({ ...visit, views: visit.views + 1 });
  }, [pathname]);

  // Installed from this page: the visit may go on to the notification card.
  useEffect(() => {
    if (install.installed) saveVisit({ ...loadVisit(), installed: true });
  }, [install.installed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: decided again on every page
  useEffect(() => {
    if (!settled) return;
    const now = Date.now();
    const platform = currentPlatform();
    const visit = loadVisit();
    const offer = installOffer(platform, install.native);
    const next = cardToShow({
      consentSettled: true,
      install: offer,
      member: member && { createdAt: Date.parse(member.createdAt) },
      push: currentAvailability(platform),
      permission: currentPermission(),
      serverPush: pushKey !== null,
      snoozes: readSnoozes(readStored(() => localStorage, PROMPTS_KEY)),
      visit,
      now,
    });
    if (next && visit.card === null) saveVisit({ ...visit, card: next });
    setShown(next && { card: next, offer });
  }, [settled, pathname, member, pushKey, install.native, install.installed]);

  if (!shown) return null;
  const putOff = (card: Card) => {
    snoozeCard(card, Date.now());
    setShown(null);
  };
  const notNow = { label: t("notNow"), onClick: () => putOff(shown.card) };

  if (shown.card === "install" && shown.offer === "native")
    return (
      <PromptCard
        icon={icon}
        title={t("install.title", { site: appName })}
        action={{
          label: t("install.action"),
          onClick: () => {
            promptInstall().then((outcome) => {
              if (outcome === "dismissed") putOff("install");
              else setShown(null);
            });
          },
        }}
        dismiss={notNow}
      >
        {t("install.body")}
      </PromptCard>
    );

  if (shown.card === "install" && shown.offer === "ios")
    return (
      <PromptCard
        icon={icon}
        title={t("ios.title", { site: appName })}
        dismiss={notNow}
      >
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>
            {t.rich("ios.share", {
              icon: () => (
                <Share
                  aria-hidden="true"
                  className="inline size-4 align-text-bottom text-foreground"
                />
              ),
            })}
          </li>
          <li>{t("ios.add")}</li>
          <li>{t("ios.open")}</li>
        </ol>
      </PromptCard>
    );

  // The notification settings have their own switch for this device.
  if (shown.card !== "push" || !pushKey || pathname === SETTINGS_PATH)
    return null;
  const enable = () => {
    setBusy(true);
    setError(null);
    turnOnPush(pushKey).then((result) => {
      setBusy(false);
      if (!result.ok && result.reason === "failed") {
        setError(result.error ?? t("push.failed"));
        return;
      }
      // Closed without an answer: the browser keeps asking only so often, so the card waits too.
      if (!result.ok && result.reason === "dismissed") putOff("push");
      else setShown(null);
    });
  };

  return (
    <PromptCard
      icon={icon}
      title={t("push.title")}
      action={{ label: t("push.enable"), onClick: enable }}
      dismiss={notNow}
      busy={busy}
      error={error}
    >
      {t("push.body")}
    </PromptCard>
  );
}
