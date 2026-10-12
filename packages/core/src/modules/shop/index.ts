import type { Ctx } from "../../context";
import * as contracts from "../../contracts/shop";
import { implement } from "../../operation";

/** Placeholder: this module is implemented in the next step of the economy work. */
const pending = (): never => {
  throw new Error("Not implemented.");
};

export const operations = [
  implement(contracts.shopCategoriesList, pending),
  implement(contracts.shopCategoriesCreate, pending),
  implement(contracts.shopCategoriesUpdate, pending),
  implement(contracts.shopCategoriesDelete, pending),
  implement(contracts.shopItemsList, pending),
  implement(contracts.shopItemsGet, pending),
  implement(contracts.shopItemsCreate, pending),
  implement(contracts.shopItemsUpdate, pending),
  implement(contracts.shopItemsDelete, pending),
  implement(contracts.shopBuy, pending),
  implement(contracts.shopInventory, pending),
  implement(contracts.shopUse, pending),
  implement(contracts.shopPurchases, pending),
];

/** Registers the module's job handlers and event subscriber. */
export function registerShopJobs(_ctx: Ctx): void {}
