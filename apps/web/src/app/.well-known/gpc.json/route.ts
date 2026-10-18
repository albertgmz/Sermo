// The Global Privacy Control support resource (W3C GPC, section 4): this site honours the signal.
// A request or a browser that sends it has every optional cookie category off until the visitor
// turns one on after it (`lib/consent`), and the cookie policy page says so. `lastUpdate` is the day
// this statement was last reviewed: change it when what the signal turns off changes. A file of the
// site, outside the language segment.
export function GET() {
  return Response.json(
    { gpc: true, lastUpdate: "2026-10-17" },
    { headers: { "cache-control": "public, max-age=86400" } },
  );
}
