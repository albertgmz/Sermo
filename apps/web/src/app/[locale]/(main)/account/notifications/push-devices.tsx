"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Help } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { removePushSubscription } from "@/lib/push-actions";
import {
  currentAvailability,
  currentPermission,
  currentPlatform,
  heldSubscription,
  onPushChange,
  turnOffPush,
  turnOnPush,
} from "@/lib/push-client";
import {
  type DeviceStatus,
  deviceName,
  deviceStatus,
  sameEndpoint,
} from "@/lib/push-device";

type Device = { endpoint: string; userAgent: string; createdAt: string };

// This device's state is known only in the browser: it is read after the page has loaded, and read
// again after every change. A subscription another member turned on, or one made for an old key, is
// let go and reads "off" (`heldSubscription`).
export function PushDevices({
  member,
  session,
  publicKey,
  devices,
}: {
  member: string;
  session: string | null;
  publicKey: string | null;
  devices: Device[];
}) {
  const t = useTranslations("account.pushDevices");
  const format = useFormatter();
  const router = useRouter();
  const [own, setOwn] = useState<{
    status: DeviceStatus;
    endpoint: string | null;
    userAgent: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const check = useCallback(async () => {
    const availability = currentAvailability(currentPlatform());
    const subscription =
      publicKey && availability === "available"
        ? await heldSubscription(member, publicKey).catch(() => null)
        : null;
    const endpoint = subscription?.endpoint ?? null;
    setOwn({
      status: deviceStatus({
        serverPush: publicKey !== null,
        availability,
        permission: currentPermission(),
        endpoint,
        listed: devices.map((device) => device.endpoint),
      }),
      endpoint,
      userAgent: navigator.userAgent,
    });
  }, [member, publicKey, devices]);

  useEffect(() => {
    void check();
  }, [check]);

  // A device put back by the page's silent check (`heldSubscription`) shows in the list. A change
  // made by this page's own buttons is redrawn once, when the button's work is done (`act`).
  const acting = useRef(false);
  useEffect(
    () =>
      onPushChange(() => {
        if (!acting.current) router.refresh();
      }),
    [router],
  );

  const nameOf = (userAgent: string) => {
    const { browser, system } = deviceName(userAgent);
    if (browser && system) return t("device", { browser, system });
    return browser ?? system ?? t("unknownDevice");
  };

  const act = (run: () => Promise<string | null>) => {
    setError(null);
    startTransition(async () => {
      acting.current = true;
      const failure = await run().finally(() => {
        acting.current = false;
      });
      if (failure) setError(failure);
      router.refresh();
      await check();
    });
  };

  const turnOn = () =>
    act(async () => {
      if (!publicKey) return null;
      const result = await turnOnPush(publicKey, member, session);
      if (result.ok || result.reason === "dismissed") return null;
      return result.reason === "denied"
        ? t("denied")
        : (result.error ?? t("failed"));
    });
  const turnOff = () =>
    act(async () => {
      const result = await turnOffPush();
      return result.ok ? null : (result.error ?? t("failed"));
    });
  const remove = (endpoint: string) =>
    act(async () => {
      const result = await removePushSubscription(endpoint);
      return result.ok ? null : result.error;
    });

  const ownEndpoint = own?.endpoint ?? null;
  const others = devices.filter(
    (device) => !ownEndpoint || !sameEndpoint(device.endpoint, ownEndpoint),
  );
  const status = own?.status;

  return (
    <div className="divide-y">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium">
            {t("thisDevice")}
            {own && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {nameOf(own.userAgent)}
              </span>
            )}
          </p>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {status === undefined
              ? t("status.checking")
              : status === "on" || status === "off"
                ? t(`status.${status}`)
                : null}
          </p>
          {status !== undefined && status !== "on" && status !== "off" && (
            <Help>{t(`status.${statusKey(status)}`)}</Help>
          )}
        </div>
        {status === "off" && (
          <Button onClick={turnOn} disabled={busy} className="h-10 md:h-8">
            {t("turnOn")}
          </Button>
        )}
        {status === "on" && (
          <Button
            variant="outline"
            onClick={turnOff}
            disabled={busy}
            className="h-10 md:h-8"
          >
            {t("turnOff")}
          </Button>
        )}
      </div>
      {others.length > 0 && (
        <div className="space-y-2 p-4">
          <p className="text-xs font-medium text-muted-foreground">
            {t("others")}
          </p>
          <ul className="space-y-2">
            {others.map((device) => (
              <li
                key={device.endpoint}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{nameOf(device.userAgent)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("added", {
                      date: format.dateTime(new Date(device.createdAt), {
                        dateStyle: "medium",
                      }),
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => remove(device.endpoint)}
                  disabled={busy}
                  aria-label={t("aria.remove", {
                    device: nameOf(device.userAgent),
                  })}
                  className="h-10 md:h-8"
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function statusKey(status: Exclude<DeviceStatus, "on" | "off">) {
  return status === "off-site" ? "offSite" : status;
}
