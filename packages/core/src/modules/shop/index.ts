import {
  categoriesCreate,
  categoriesDelete,
  categoriesList,
  categoriesUpdate,
  itemsCreate,
  itemsDelete,
  itemsGet,
  itemsList,
  itemsUpdate,
} from "./catalog";
import { buy, inventory, purchases, upgrade, use } from "./inventory";

export { registerShopJobs } from "./expiry";

export const operations = [
  categoriesList,
  categoriesCreate,
  categoriesUpdate,
  categoriesDelete,
  itemsList,
  itemsGet,
  itemsCreate,
  itemsUpdate,
  itemsDelete,
  buy,
  upgrade,
  inventory,
  use,
  purchases,
];
