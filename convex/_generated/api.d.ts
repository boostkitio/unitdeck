/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_briefParser from "../agents/briefParser.js";
import type * as agents_callSheetChecker from "../agents/callSheetChecker.js";
import type * as agents_messageDrafter from "../agents/messageDrafter.js";
import type * as callSheets from "../callSheets.js";
import type * as clients from "../clients.js";
import type * as dashboard from "../dashboard.js";
import type * as distribution from "../distribution.js";
import type * as feedback from "../feedback.js";
import type * as lib_agentProposals from "../lib/agentProposals.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_callSheetData from "../lib/callSheetData.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_llm from "../lib/llm.js";
import type * as locations from "../locations.js";
import type * as organisations from "../organisations.js";
import type * as people from "../people.js";
import type * as projects from "../projects.js";
import type * as setMode from "../setMode.js";
import type * as shootDays from "../shootDays.js";
import type * as waitlist from "../waitlist.js";
import type * as wrap from "../wrap.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/briefParser": typeof agents_briefParser;
  "agents/callSheetChecker": typeof agents_callSheetChecker;
  "agents/messageDrafter": typeof agents_messageDrafter;
  callSheets: typeof callSheets;
  clients: typeof clients;
  dashboard: typeof dashboard;
  distribution: typeof distribution;
  feedback: typeof feedback;
  "lib/agentProposals": typeof lib_agentProposals;
  "lib/ai": typeof lib_ai;
  "lib/auth": typeof lib_auth;
  "lib/callSheetData": typeof lib_callSheetData;
  "lib/email": typeof lib_email;
  "lib/llm": typeof lib_llm;
  locations: typeof locations;
  organisations: typeof organisations;
  people: typeof people;
  projects: typeof projects;
  setMode: typeof setMode;
  shootDays: typeof shootDays;
  waitlist: typeof waitlist;
  wrap: typeof wrap;
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
