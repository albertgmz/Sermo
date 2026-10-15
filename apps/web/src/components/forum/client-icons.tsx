import type { Device } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// What the backend parsed from a user agent and stored: only its names are shown. The icons are
// picked from the names (a "Chrome Mobile" or "Microsoft Edge" is still Chrome or Edge).
type Client = Pick<z.output<typeof Device>, "browser" | "os">;
type Browser = "chrome" | "firefox" | "safari" | "edge" | "opera" | "other";
type Os = "windows" | "macos" | "linux" | "android" | "ios" | "other";

const BROWSER_NAMES: [Browser, RegExp][] = [
  ["edge", /edge/i],
  ["opera", /opera/i],
  ["firefox", /firefox/i],
  ["chrome", /chrom/i],
  ["safari", /safari/i],
];

const SYSTEM_NAMES: [Os, RegExp][] = [
  ["android", /android/i],
  ["ios", /^i(?:pad)?os$/i],
  ["windows", /windows/i],
  ["macos", /^mac/i],
  ["linux", /linux|ubuntu|debian|fedora|chrome os/i],
];

const browserOf = (client: Client): Browser =>
  BROWSER_NAMES.find(([, pattern]) =>
    pattern.test(client.browser ?? ""),
  )?.[0] ?? "other";
const systemOf = (client: Client): Os =>
  SYSTEM_NAMES.find(([, pattern]) => pattern.test(client.os ?? ""))?.[0] ??
  "other";

const FILLED = {
  fill: "currentColor",
  fillRule: "evenodd",
  stroke: "none",
} as const;

const APPLE = (
  <path
    {...FILLED}
    d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.2 3.09 3.79 3.04 1.52-.07 2.09-.99 3.93-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.15-1.69 1.63-3.32 1.66-3.41-.04-.01-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.49 2.6-4.56-1.43-2.09-3.63-2.32-4.39-2.37-2-.16-3.68 1.09-4.61 1.09ZM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.66.8-3.53 1.82-.78.9-1.46 2.34-1.28 3.71 1.34.11 2.72-.68 3.56-1.7Z"
  />
);

const BROWSERS: Record<Browser, { glyph: React.ReactNode }> = {
  chrome: {
    glyph: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 8h9.2M8.5 14 3.9 6M15.5 14l-4.6 8" />
      </>
    ),
  },
  firefox: {
    glyph: (
      <path
        {...FILLED}
        d="M20.6 8.3c-.4-1-1.3-2.2-2-2.5.6 1.1.9 2.2 1 3-1.2-3-3.2-4.2-4.9-6.800l-.3-.4c-1.8 1.1-2.6 3-2.7 4.300a4.3 4.3 0 0 0-2.4.9 2.6 2.6 0 0 0-.2-.2 4 4 0 0 1 0-2.100A6.4 6.4 0 0 0 7 6.100c-.6-.3-1-.9-1.2-1.500C4.4 5.4 3.3 7.3 3 9c-.6 2.8.2 5.8 2.2 7.800a9.4 9.4 0 0 0 9.3 2.300c4.3-1.3 7.2-6.3 6.1-10.800ZM12.3 16.600a4 4 0 0 1-3.9-3c.5.3 1.3.3 1.9 0l1-.600c.4-.2.8-.2 1.2-.1.4 0 .5-.2.4-.400a2 2 0 0 0-1.7-.900c.7-.4 1.9-.3 2.8.300a4 4 0 0 1-1.7 4.700Z"
      />
    ),
  },
  safari: {
    glyph: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path
          {...FILLED}
          d="m17 7-3.2 6.800L7 17l3.2-6.800Zm-5 3.900a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.200Z"
        />
      </>
    ),
  },
  edge: {
    glyph: (
      <path
        {...FILLED}
        d="M12 2a10 10 0 0 1 10 9.600c0 2.6-1.9 4.4-4.3 4.4-1.9 0-3.2-.9-3.2-2.1 0-.7.5-1 .5-2 0-1.8-1.6-3.4-4-3.4-3.2 0-5.7 2.7-5.7 6.2 0 3.8 3 7.3 7.7 7.3 1.4 0 2.7-.3 3.9-.900A10 10 0 1 1 12 2Zm-.9 9.300c-1.3 0-2.3 1.3-2.3 3.1 0 2.7 2.3 5 5.6 5 2.5 0 4.6-1.2 5.9-2.8-.9.5-1.9.8-3 .8-3 0-5.2-1.7-5.2-4 0-.7.2-1.2.2-1.5 0-.4-.5-.6-1.2-.600Z"
      />
    ),
  },
  opera: {
    glyph: (
      <path
        {...FILLED}
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.200c2.1 0 3.8 3 3.8 6.800s-1.7 6.8-3.8 6.8-3.8-3-3.8-6.8 1.7-6.8 3.8-6.800Z"
      />
    ),
  },
  other: {
    glyph: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <ellipse cx="12" cy="12" rx="4" ry="10" />
      </>
    ),
  },
};

const SYSTEMS: Record<Os, { glyph: React.ReactNode }> = {
  windows: {
    glyph: (
      <path
        {...FILLED}
        d="M2 2h9.500v9.500H2zM12.5 2H22v9.500h-9.500zM2 12.500h9.500V22H2zM12.5 12.500H22V22h-9.500z"
      />
    ),
  },
  macos: { glyph: APPLE },
  linux: {
    glyph: (
      <path
        {...FILLED}
        d="M12 1.500c-2.3 0-3.7 1.8-3.7 4.2 0 1.5.1 2.4-.6 3.7-1.1 2-3.2 4.6-3.2 7.6 0 .7.1 1.4.4 2l-1.7 1.400c-.6.5-.3 1.6.6 1.600h5.100c.7 0 1.2-.4 1.3-1h3.600c.1.6.6 1 1.3 1h5.100c.9 0 1.2-1.1.6-1.600L19.1 19c.3-.6.4-1.3.4-2 0-3-2.1-5.6-3.2-7.6-.7-1.3-.6-2.2-.6-3.7 0-2.4-1.4-4.2-3.7-4.200Zm-1.5 3.300a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.800Zm3 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.800ZM12 9.500c1.8 2.2 3.2 4.5 3.2 6.8 0 1.6-1.3 2.7-3.2 2.700s-3.2-1.1-3.2-2.700c0-2.3 1.4-4.6 3.2-6.800Z"
      />
    ),
  },
  android: {
    glyph: (
      <path
        {...FILLED}
        d="m6.3 9.4-1.8-3a.7.7 0 0 1 1.2-.700l1.8 3.100a11 11 0 0 1 9 0l1.8-3.100a.7.7 0 0 1 1.2.700l-1.8 3A10 10 0 0 1 23 18H1a10 10 0 0 1 5.3-8.600ZM7 13a1.2 1.2 0 1 0 0 2.400A1.2 1.2 0 0 0 7 13Zm10 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.400Z"
      />
    ),
  },
  ios: { glyph: APPLE },
  other: {
    glyph: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
};

type Translate = ReturnType<typeof useTranslations<"forum.clientIcons">>;

// "Chrome on Windows", with a stand-in for a name the backend could not parse.
export function clientLabel(client: Client, t: Translate): string {
  return t("label", {
    browser: client.browser ?? t("unknownBrowser"),
    system: client.os ?? t("unknownSystem"),
  });
}

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      {children}
    </svg>
  );
}

export function ClientIcons({
  client,
  className,
}: {
  client: Client;
  className?: string;
}) {
  const t = useTranslations("forum.clientIcons");
  const text = clientLabel(client, t);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={text}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 align-middle text-muted-foreground",
              className,
            )}
          />
        }
      >
        <Glyph>{BROWSERS[browserOf(client)].glyph}</Glyph>
        <Glyph>{SYSTEMS[systemOf(client)].glyph}</Glyph>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
