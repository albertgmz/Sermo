"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { consentSettled } from "@/components/layout/consent-library";
import { PromptCard } from "@/components/layout/prompt-card";
import {
  type Card,
  cardToShow,
  PROMPTS_KEY,
  readSnoozes,
  readVisit,
  VISIT_KEY,
  type Visit,
} from "@/lib/app-prompts";
import {
  currentAvailability,
  currentPermission,
  currentPlatform,
  turnOnPush,
} from "@/lib/push-client";

// The card that offers notifications (`lib/app-prompts.ts` decides when). It waits for the cookie
// banner, counts the pages of the visit, and is decided again on every page.

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

const loadVisit = () => readVisit(readStored(() => sessionStorage, VISIT_KEY));

export function AppPrompts({
  member,
  pushKey,
  icon,
}: {
  member: { createdAt: string } | null;
  pushKey: string | null;
  icon: React.ReactNode;
}) {
  const t = useTranslations("layout.appPrompts");
  const pathname = usePathname();
  const [settled, setSettled] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: decided again on every page
  useEffect(() => {
    if (!settled) return;
    const now = Date.now();
    const platform = currentPlatform();
    const visit = loadVisit();
    const next = cardToShow({
      consentSettled: true,
      install: null,
      member: member && { createdAt: Date.parse(member.createdAt) },
      push: currentAvailability(platform),
      permission: currentPermission(),
      serverPush: pushKey !== null,
      snoozes: readSnoozes(readStored(() => localStorage, PROMPTS_KEY)),
      visit,
      now,
    });
    if (next && visit.card === null) saveVisit({ ...visit, card: next });
    setCard(next);
  }, [settled, pathname, member, pushKey]);

  if (card !== "push" || !pushKey) return null;

  const notNow = () => {
    snoozeCard("push", Date.now());
    setCard(null);
  };
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
      if (!result.ok && result.reason === "dismissed")
        snoozeCard("push", Date.now());
      setCard(null);
    });
  };

  return (
    <PromptCard
      icon={icon}
      title={t("push.title")}
      action={{ label: t("push.enable"), onClick: enable }}
      dismiss={{ label: t("notNow"), onClick: notNow }}
      busy={busy}
      error={error}
    >
      {t("push.body")}
    </PromptCard>
  );
}
