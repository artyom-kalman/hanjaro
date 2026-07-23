/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
	ApiFromModules,
	FilterApi,
	FunctionReference,
} from "convex/server";
import type * as chars from "../chars.js";
import type * as hanja from "../hanja.js";
import type * as hanjaFormat from "../hanjaFormat.js";
import type * as http from "../http.js";
import type * as i18n from "../i18n.js";
import type * as keyboards from "../keyboards.js";
import type * as krdict from "../krdict.js";
import type * as llmJson from "../llmJson.js";
import type * as lookup from "../lookup.js";
import type * as registerWebhook from "../registerWebhook.js";
import type * as telegram from "../telegram.js";
import type * as translate from "../translate.js";
import type * as translationNeeds from "../translationNeeds.js";
import type * as userSettings from "../userSettings.js";
import type * as wordPrompt from "../wordPrompt.js";
import type * as words from "../words.js";

declare const fullApi: ApiFromModules<{
	chars: typeof chars;
	hanja: typeof hanja;
	hanjaFormat: typeof hanjaFormat;
	http: typeof http;
	i18n: typeof i18n;
	keyboards: typeof keyboards;
	krdict: typeof krdict;
	llmJson: typeof llmJson;
	lookup: typeof lookup;
	registerWebhook: typeof registerWebhook;
	telegram: typeof telegram;
	translate: typeof translate;
	translationNeeds: typeof translationNeeds;
	userSettings: typeof userSettings;
	wordPrompt: typeof wordPrompt;
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
