"use client";

import {
  type AbstractIntlMessages,
  NextIntlClientProvider,
  useLocale,
  useMessages,
} from "next-intl";
import { type ReactNode, useMemo } from "react";

type Zones = Record<string, Record<string, unknown>>;

// The provider takes one messages object and does not merge it with the parent's. It is two levels
// deep: zone, then component.
function merged(inherited: Zones, more: Zones) {
  const result: Zones = { ...inherited };
  for (const [zone, components] of Object.entries(more))
    result[zone] = { ...result[zone], ...components };
  return result as AbstractIntlMessages;
}

export function MoreMessages({
  messages,
  children,
}: {
  messages: Zones;
  children: ReactNode;
}) {
  const locale = useLocale();
  const inherited = useMessages() as Zones;
  const all = useMemo(() => merged(inherited, messages), [inherited, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={all}>
      {children}
    </NextIntlClientProvider>
  );
}
