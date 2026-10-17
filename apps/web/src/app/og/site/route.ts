import type { NextRequest } from "next/server";
import { siteCard } from "@/lib/og/respond";

// The site's share card (a PNG), for the public pages without one of their own. A file of the
// site, outside the language segment: the proxy leaves `/og/` alone.
export async function GET(request: NextRequest) {
  return siteCard(request.nextUrl.searchParams.get("v"));
}
