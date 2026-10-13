import "server-only";

import { notFound } from "next/navigation";
import { mayOpenStyleguide } from "@/app/(staff)/registry";
import { viewerOfRequest } from "@/lib/sermo/client";

// The demo actions answer only a caller who may open the styleguide: an action can be posted to
// without ever loading the page.
export async function requireStyleguide() {
  if (!mayOpenStyleguide(await viewerOfRequest())) notFound();
}
