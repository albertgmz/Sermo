"use client";

import {
  environmentManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

let browserClient: QueryClient | undefined;

// The server makes a client per request; the browser keeps one for the life of the page, so a
// render that suspends does not throw it away. The lists that read it keep no data past their
// screen (see `listQueryOptions`), so nothing here outlives a navigation.
function queryClient() {
  if (environmentManager.isServer()) return new QueryClient();
  browserClient ??= new QueryClient();
  return browserClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient()}>{children}</QueryClientProvider>
  );
}
