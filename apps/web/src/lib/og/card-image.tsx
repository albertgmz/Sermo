import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { DEFAULT_ICON_URL } from "@/lib/default-icon";
import {
  CARD_COLOURS,
  CARD_SIZE,
  type CardBrand,
  type CardContent,
  type CardPerson,
  type CardPlan,
  planCard,
  titleLayout,
} from "./card";
import { codePointsOf } from "./font-coverage";

// The fonts are files of the app (assets/og, Inter under the SIL Open Font License), read once:
// nothing is fetched while a card is drawn. Each path is written out, so the build's file tracing
// finds it (the route's .nft.json lists the three files, and the standalone output copies them).
const [display, semiBold, regular] = await Promise.all([
  readFile(join(process.cwd(), "assets/og/InterDisplay-Bold.ttf")),
  readFile(join(process.cwd(), "assets/og/Inter-SemiBold.ttf")),
  readFile(join(process.cwd(), "assets/og/Inter-Regular.ttf")),
]);
const FONTS = [
  { name: "Inter Display", data: display, weight: 700 as const },
  { name: "Inter", data: semiBold, weight: 600 as const },
  { name: "Inter", data: regular, weight: 400 as const },
];
const COVERED = new Set(
  [display, semiBold, regular].flatMap((font) => [...codePointsOf(font)]),
);
export const covers = (codePoint: number) => COVERED.has(codePoint);

// The card is the dark theme's surface with a light hairline at its edge and the accent across
// its top: it keeps its shape on a white page and on a black one. Text stays light on dark; the
// accent is never the colour of text, whatever the administrator chose. The secondary text is set
// large enough to read when an app shows the card about 500 pixels wide.
const { surface, raised, edge, ink, muted } = CARD_COLOURS;
// Kept clear of the edges, which apps crop differently.
const PAD = 72;
const SMALL = 32;

// The site's mark: its uploaded icon when it could be read, else the drawn mark in the accent.
function Mark({
  brand,
  icon,
  size,
}: {
  brand: CardBrand;
  icon: string | null;
  size: number;
}) {
  const src =
    icon ??
    DEFAULT_ICON_URL.replace("%23dc2626", encodeURIComponent(brand.accent));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.24,
        background: raised,
        border: `2px solid ${edge}`,
        overflow: "hidden",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: drawn into a PNG, never into a page */}
      <img
        src={src}
        alt=""
        width={icon ? size : size * 0.7}
        height={icon ? size : size * 0.7}
      />
    </div>
  );
}

// A member in a circle of the accent: their initial, or the generic member mark (a head and
// shoulders, SVG text percent-encoded like the default icon, stroked white) when the name has no
// letter the card can draw.
const MEMBER_MARK =
  "%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%228%22%20r%3D%224.5%22%2F%3E%3Cpath%20d%3D%22M4%2021a8%208%200%200%201%2016%200%22%2F%3E%3C%2Fsvg%3E";

const memberMark = (colour: string) =>
  `data:image/svg+xml,${MEMBER_MARK.replace("%23ffffff", encodeURIComponent(colour))}`;

function Avatar({
  initial,
  brand,
  size,
}: {
  initial: string;
  brand: CardBrand;
  size: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 2,
        background: brand.accent,
        color: brand.onAccent,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: size * 0.48,
      }}
    >
      {initial || (
        // biome-ignore lint/performance/noImgElement: drawn into a PNG, never into a page
        <img
          src={memberMark(brand.onAccent)}
          alt=""
          width={size * 0.56}
          height={size * 0.56}
        />
      )}
    </div>
  );
}

function SiteLine({
  site,
  brand,
  icon,
}: {
  site: string;
  brand: CardBrand;
  icon: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
      <Mark brand={brand} icon={icon} size={64} />
      {site !== "" && (
        <div
          style={{
            display: "flex",
            fontFamily: "Inter",
            fontWeight: 600,
            fontSize: 34,
            color: ink,
          }}
        >
          {site}
        </div>
      )}
    </div>
  );
}

function Title({ value }: { value: string }) {
  const layout = titleLayout(value);
  return (
    <div
      style={{
        display: "block",
        fontFamily: "Inter Display",
        fontWeight: 700,
        fontSize: layout.fontSize,
        lineHeight: 1.12,
        letterSpacing: "-0.02em",
        color: ink,
        lineClamp: layout.lines,
      }}
    >
      {layout.text}
    </div>
  );
}

function Description({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div
      style={{
        display: "block",
        marginTop: 26,
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 34,
        lineHeight: 1.35,
        color: muted,
        lineClamp: 2,
      }}
    >
      {value}
    </div>
  );
}

// A small label with an accent dot: the forum a thread is in, the forums above a forum.
function Chip({ label, brand }: { label: string; brand: CardBrand }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 24px",
        borderRadius: 999,
        background: raised,
        border: `2px solid ${edge}`,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: SMALL,
        color: ink,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          background: brand.accent,
        }}
      />
      {label}
    </div>
  );
}

function Person({ person, brand }: { person: CardPerson; brand: CardBrand }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: SMALL,
        color: ink,
      }}
    >
      <Avatar initial={person.initial} brand={brand} size={56} />
      <div style={{ display: "flex" }}>{person.name}</div>
    </div>
  );
}

function Frame({ brand, children }: { brand: CardBrand; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: surface,
        border: `2px solid ${edge}`,
      }}
    >
      <div style={{ display: "flex", height: 12, background: brand.accent }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          padding: `${PAD - 12}px ${PAD}px ${PAD}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// The middle of the card, between the site's line and the foot (or the bottom edge). `lower`
// moves it down a little where no foot balances the site's line.
function Body({ children, lower }: { children: ReactNode; lower?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flexGrow: 1,
        paddingTop: lower ? 56 : 8,
        paddingBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Card({
  plan,
  brand,
  icon,
}: {
  plan: CardPlan;
  brand: CardBrand;
  icon: string | null;
}) {
  if (plan.layout === "site") {
    return (
      <Frame brand={brand}>
        <Body>
          <Mark brand={brand} icon={icon} size={136} />
          {plan.site !== "" && (
            <div style={{ display: "flex", marginTop: 44 }}>
              <Title value={plan.site} />
            </div>
          )}
          <Description value={plan.description} />
        </Body>
      </Frame>
    );
  }
  if (plan.layout === "member") {
    const { member } = plan;
    return (
      <Frame brand={brand}>
        <SiteLine site={plan.site} brand={brand} icon={icon} />
        <Body lower>
          <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
            <Avatar initial={member.initial} brand={brand} size={184} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {member.name !== "" && <Title value={member.name} />}
              <Description value={plan.description} />
            </div>
          </div>
        </Body>
      </Frame>
    );
  }
  return (
    <Frame brand={brand}>
      <SiteLine site={plan.site} brand={brand} icon={icon} />
      <Body>
        <Title value={plan.headline} />
        <Description value={plan.description} />
      </Body>
      {(plan.chip !== "" || plan.author !== null) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 32,
          }}
        >
          {plan.chip ? <Chip label={plan.chip} brand={brand} /> : <div />}
          {plan.author !== null && (
            <Person person={plan.author} brand={brand} />
          )}
        </div>
      )}
    </Frame>
  );
}

// The card as a PNG. `icon` is the site's icon as a data URL, or null for the drawn mark.
export async function drawCard(
  content: CardContent,
  brand: CardBrand,
  icon: string | null,
): Promise<ArrayBuffer> {
  const response = new ImageResponse(
    <Card plan={planCard(content, brand, covers)} brand={brand} icon={icon} />,
    { ...CARD_SIZE, fonts: FONTS },
  );
  return response.arrayBuffer();
}
