import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { DEFAULT_ICON_URL } from "@/lib/default-icon";
import {
  CARD_SIZE,
  type CardBrand,
  type CardContent,
  clampText,
  DESCRIPTION_MAX,
  drawable,
  titleLayout,
} from "./card";
import { codePointsOf } from "./font-coverage";

// The fonts are files of the app (assets/og, Inter under the SIL Open Font License), read once:
// nothing is fetched while a card is drawn. Each path is written out, so the build's file tracing
// finds it.
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
const covers = (codePoint: number) => COVERED.has(codePoint);
const text = (value: string) => drawable(value, covers);

// The card is the dark theme's surface with a light hairline at its edge and the accent across
// its top: it keeps its shape on a white page and on a black one. Text stays light on dark; the
// accent is never the colour of text, whatever the administrator chose.
const SURFACE = "#111114";
const RAISED = "#1c1c21";
const EDGE = "#2e2e35";
const INK = "#fafafa";
const MUTED = "#a1a1aa";
// Kept clear of the edges, which apps crop differently.
const PAD = 72;

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
        borderRadius: size * 0.24,
        background: RAISED,
        border: `2px solid ${EDGE}`,
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

// The first letter of a member's name on the accent, in place of a picture.
function Monogram({
  name,
  brand,
  size,
}: {
  name: string;
  brand: CardBrand;
  size: number;
}) {
  const letter = Array.from(text(name))[0]?.toLocaleUpperCase() ?? "";
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
      {letter}
    </div>
  );
}

function SiteLine({ brand, icon }: { brand: CardBrand; icon: string | null }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <Mark brand={brand} icon={icon} size={60} />
      <div
        style={{
          display: "flex",
          fontFamily: "Inter",
          fontWeight: 600,
          fontSize: 30,
          color: INK,
        }}
      >
        {clampText(text(brand.name), 40)}
      </div>
    </div>
  );
}

// The headline in what the fonts draw; the site's name when nothing of it is left.
function Title({ value, brand }: { value: string; brand: CardBrand }) {
  const layout = titleLayout(text(value) || text(brand.name));
  return (
    <div
      style={{
        display: "block",
        fontFamily: "Inter Display",
        fontWeight: 700,
        fontSize: layout.fontSize,
        lineHeight: 1.12,
        letterSpacing: "-0.02em",
        color: INK,
        lineClamp: layout.lines,
      }}
    >
      {layout.text}
    </div>
  );
}

function Description({ value }: { value: string }) {
  const shown = clampText(text(value), DESCRIPTION_MAX);
  if (!shown) return null;
  return (
    <div
      style={{
        display: "block",
        marginTop: 24,
        fontFamily: "Inter",
        fontWeight: 400,
        fontSize: 32,
        lineHeight: 1.35,
        color: MUTED,
        lineClamp: 2,
      }}
    >
      {shown}
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
        padding: "12px 22px",
        borderRadius: 999,
        background: RAISED,
        border: `2px solid ${EDGE}`,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 28,
        color: INK,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          background: brand.accent,
        }}
      />
      {label}
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
        background: SURFACE,
        border: `2px solid ${EDGE}`,
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

function Body({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flexGrow: 1,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 32,
      }}
    >
      {children}
    </div>
  );
}

function Person({ name, brand }: { name: string; brand: CardBrand }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "Inter",
        fontWeight: 600,
        fontSize: 28,
        color: MUTED,
      }}
    >
      <Monogram name={name} brand={brand} size={48} />
      {clampText(text(name), 28)}
    </div>
  );
}

function ThreadCard({
  content,
  brand,
  icon,
}: {
  content: Extract<CardContent, { kind: "threads" }>;
  brand: CardBrand;
  icon: string | null;
}) {
  const forum = clampText(text(content.forum), 36);
  return (
    <Frame brand={brand}>
      <SiteLine brand={brand} icon={icon} />
      <Body>
        <Title value={content.title} brand={brand} />
      </Body>
      <Footer>
        {forum ? <Chip label={forum} brand={brand} /> : <div />}
        <Person name={content.author} brand={brand} />
      </Footer>
    </Frame>
  );
}

function ForumCard({
  content,
  brand,
  icon,
}: {
  content: Extract<CardContent, { kind: "forums" }>;
  brand: CardBrand;
  icon: string | null;
}) {
  const parents = clampText(
    content.parents.map(text).filter(Boolean).join(" / "),
    48,
  );
  return (
    <Frame brand={brand}>
      <SiteLine brand={brand} icon={icon} />
      <Body>
        <Title value={content.title} brand={brand} />
        <Description value={content.description} />
      </Body>
      <Footer>
        {parents ? <Chip label={parents} brand={brand} /> : <div />}
      </Footer>
    </Frame>
  );
}

function MemberCard({
  content,
  brand,
  icon,
}: {
  content: Extract<CardContent, { kind: "members" }>;
  brand: CardBrand;
  icon: string | null;
}) {
  return (
    <Frame brand={brand}>
      <SiteLine brand={brand} icon={icon} />
      <Body>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <Monogram name={content.title} brand={brand} size={152} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            <Title value={content.title} brand={brand} />
            <Description value={content.description} />
          </div>
        </div>
      </Body>
    </Frame>
  );
}

function SiteCard({
  content,
  brand,
  icon,
}: {
  content: Extract<CardContent, { kind: "site" }>;
  brand: CardBrand;
  icon: string | null;
}) {
  return (
    <Frame brand={brand}>
      <Body>
        <Mark brand={brand} icon={icon} size={128} />
        <div style={{ display: "flex", height: 44 }} />
        <Title value={content.title} brand={brand} />
        <Description value={content.description} />
      </Body>
    </Frame>
  );
}

function Card(props: {
  content: CardContent;
  brand: CardBrand;
  icon: string | null;
}) {
  const { content, brand, icon } = props;
  switch (content.kind) {
    case "threads":
      return <ThreadCard content={content} brand={brand} icon={icon} />;
    case "forums":
      return <ForumCard content={content} brand={brand} icon={icon} />;
    case "members":
      return <MemberCard content={content} brand={brand} icon={icon} />;
    case "site":
      return <SiteCard content={content} brand={brand} icon={icon} />;
  }
}

// The card as a PNG. `icon` is the site's icon as a data URL, or null for the drawn mark.
export async function drawCard(
  content: CardContent,
  brand: CardBrand,
  icon: string | null,
): Promise<ArrayBuffer> {
  const response = new ImageResponse(
    <Card content={content} brand={brand} icon={icon} />,
    { ...CARD_SIZE, fonts: FONTS },
  );
  return response.arrayBuffer();
}
