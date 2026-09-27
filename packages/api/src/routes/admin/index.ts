import { Hono } from "hono";
import { catalog } from "./catalog";
import { customers } from "./customers";
import { overview } from "./overview";
import { sources } from "./sources";
import { system } from "./system";

/** The admin and org-structure routes, mounted at the API root. */
export const admin = new Hono()
  .route("/", overview)
  .route("/", system)
  .route("/", catalog)
  .route("/", customers)
  .route("/", sources);
