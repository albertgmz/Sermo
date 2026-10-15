import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// The lists read their query from a provider; a test gets a client of its own.
export function withQuery(children: ReactNode) {
  return createElement(QueryClientProvider, {
    client: new QueryClient(),
    children,
  });
}
