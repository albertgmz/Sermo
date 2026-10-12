import { getOperation } from "@sermo/core";
import { routes } from "./route-table";

export * from "./route-table";

export const routeOperations = routes.map((route) => ({
  route,
  op: getOperation(route.operation),
}));
