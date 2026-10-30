"use client";

import { useLocale } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { formatPast, inDateBand } from "@/lib/format";

const MINUTE = 60_000;

/**
 * The text of a `RelativeTime`. It first draws with the `now` the server read, so the browser's
 * first render matches the server's. After that it follows the browser's clock, one step a minute.
 * `before` is drawn ahead of a date only (not of an age): the "on" or "el" of the sentence.
 */
export function LiveAge({
  date,
  now,
  justNow,
  before,
}: {
  date: string;
  now: number;
  justNow: string;
  before?: ReactNode;
}) {
  const locale = useLocale();
  const [current, setCurrent] = useState(now);

  useEffect(() => {
    const tick = () => setCurrent(Date.now());
    tick();
    const timer = setInterval(tick, MINUTE);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {inDateBand(date, current) && before}
      {formatPast(date, current, locale, justNow)}
    </>
  );
}
