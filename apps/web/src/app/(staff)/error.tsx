"use client";

import { RouteError } from "@/components/layout/route-error";

export default function RouteErrorPage(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError {...props} />;
}
