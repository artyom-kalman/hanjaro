/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as hanja from "../hanja.js";
import type * as http from "../http.js";
import type * as i18n from "../i18n.js";
import type * as krdict from "../krdict.js";
import type * as registerWebhook from "../registerWebhook.js";
import type * as telegram from "../telegram.js";
import type * as userSettings from "../userSettings.js";
import type * as words from "../words.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  hanja: typeof hanja;
  http: typeof http;
  i18n: typeof i18n;
  krdict: typeof krdict;
  registerWebhook: typeof registerWebhook;
  telegram: typeof telegram;
  userSettings: typeof userSettings;
  words: typeof words;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
