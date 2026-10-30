"use client";

import { useLocale } from "next-intl";
import { useEffect, useState } from "react";
import { formatPast } from "@/lib/format";

const MINUTE = 60_000;

/**
 * The text of a `RelativeTime`. It first draws with the `now` the server read, so the browser's
 * first render matches the server's. After that it follows the browser's clock, one step a minute.
 */
export function LiveAge({
  date,
  now,
  justNow,
}: {
  date: string;
  now: number;
  justNow: string;
}) {
  const locale = useLocale();
  const [current, setCurrent] = useState(now);

  useEffect(() => {
    const tick = () => setCurrent(Date.now());
    tick();
    const timer = setInterval(tick, MINUTE);
    return () => clearInterval(timer);
  }, []);

  return formatPast(date, current, locale, justNow);
}
