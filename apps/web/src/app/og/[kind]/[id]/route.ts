import type { NextRequest } from "next/server";
import { pageCard } from "@/lib/og/respond";

// The share card (a PNG) of a thread, forum or member that guests may open:
// `/og/threads/<id>?v=<key>`, `/og/forums/<id>`, `/og/members/<id>`.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  return pageCard(kind, id, request.nextUrl.searchParams.get("v"));
}
