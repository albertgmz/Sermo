"use client";

import { Share } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { consentSettled } from "@/components/layout/consent-library";
import { PromptCard } from "@/components/layout/prompt-card";
import {
  type Card,
  cardToShow,
  type InstallOffer,
  installOffer,
  PROMPTS_KEY,
  pageSeen,
  readSnoozes,
  readVisit,
  VISIT_KEY,
  type Visit,
} from "@/lib/app-prompts";
import {
  hostInstallCard,
  promptInstall,
  useInstallState,
} from "@/lib/install-prompt";
import {
  currentAvailability,
  currentPermission,
  currentPlatform,
  heldSubscription,
  onPushChange,
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

// The notification settings have their own switch for this device.
const SETTINGS_PATH = "/account/notifications";
// After the cookie banner, a moment for the browser to say it can install the forum: the install
// card comes first, and the event can come after the banner of a returning visitor has settled.
const GRACE_MS = 1500;

const loadVisit = () => readVisit(readStored(() => sessionStorage, VISIT_KEY));

export function AppPrompts({
  member,
  offers,
  pushKey,
  appName,
  icon,
}: {
  member: { id: string; createdAt: string } | null;
  // False while a member has terms to accept: no card, only the subscription check.
  offers: boolean;
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
  const memberId = member?.id ?? null;
  const createdAt = member?.createdAt ?? null;
  // Whether this browser holds a subscription that serves the viewer (null while it is read). One
  // that does not (another member's, a guest's browser, an old key) is let go at once, whatever the
  // cookie banner says: that only removes.
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  // What the account menu had asked for when this mounted: only a new ask shows the card.
  const asked = useRef(install.asked);

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

  // Read again when the settings turn this device on or off.
  useEffect(() => {
    let live = true;
    const read = () => {
      const usable =
        currentAvailability(currentPlatform()) === "available" &&
        currentPermission() === "granted";
      (usable
        ? heldSubscription(memberId, pushKey).then(
            (held) => held !== null,
            () => true,
          )
        : Promise.resolve(false)
      ).then((held) => {
        if (live) setSubscribed(held);
      });
    };
    read();
    const stop = onPushChange(read);
    return () => {
      live = false;
      stop();
    };
  }, [memberId, pushKey]);

  // One page more in this visit, then the card for this page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page is what counts
  useEffect(() => {
    saveVisit(pageSeen(loadVisit(), memberId));
  }, [pathname, memberId]);

  // Installed from this page: the visit may go on to the notification card.
  useEffect(() => {
    if (install.installed) saveVisit({ ...loadVisit(), installed: true });
  }, [install.installed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: decided again on every page
  useEffect(() => {
    if (!settled || !offers || subscribed === null) return;
    const platform = currentPlatform();
    const visit = loadVisit();
    const offer = installOffer(platform, install.native);
    const next = cardToShow({
      consentSettled: true,
      install: offer,
      member: createdAt ? { createdAt: Date.parse(createdAt) } : null,
      push: currentAvailability(platform),
      permission: currentPermission(),
      subscribed,
      serverPush: pushKey !== null,
      snoozes: readSnoozes(readStored(() => localStorage, PROMPTS_KEY)),
      visit,
      now: Date.now(),
    });
    // A card is the visit's only once it is drawn.
    const drawn = next === "push" && pathname === SETTINGS_PATH ? null : next;
    if (drawn && visit.card === null) saveVisit({ ...visit, card: drawn });
    setShown(drawn && { card: drawn, offer });
  }, [
    settled,
    offers,
    subscribed,
    pathname,
    createdAt,
    pushKey,
    install.native,
    install.installed,
  ]);

  useEffect(() => (offers ? hostInstallCard() : undefined), [offers]);

  // The account menu asked for the install card: shown whatever "Not now" said, once the cookie
  // banner is out of the way.
  useEffect(() => {
    if (!settled || install.asked === asked.current) return;
    asked.current = install.asked;
    const offer = installOffer(currentPlatform(), false);
    if (offer) setShown({ card: "install", offer });
  }, [settled, install.asked]);

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

  if (shown.card !== "push" || !pushKey || !memberId) return null;
  const enable = () => {
    setBusy(true);
    setError(null);
    turnOnPush(pushKey, memberId).then((result) => {
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
