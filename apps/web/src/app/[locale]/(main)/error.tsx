"use client";

import dynamic from "next/dynamic";
import { RouteError } from "@/components/layout/route-error";
import { adultReasonOfDigest } from "@/lib/sermo/errors";

// The +18 page and its warning window are fetched only when a page is refused as +18.
const AdultGate = dynamic(() =>
  import("@/components/forum/adult-gate").then((gate) => gate.AdultGate),
);

// Content refused as +18 draws the +18 page (and, for a member, the warning window) in its place;
// any other failure is the error screen.
export default function RouteErrorPage(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const adult = adultReasonOfDigest(props.error.digest);
  if (adult) return <AdultGate reason={adult} retry={props.retry} />;
  return <RouteError {...props} />;
}
