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
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as demoData from "../demoData.js";
import type * as distribution from "../distribution.js";
import type * as documents from "../documents.js";
import type * as equipment from "../equipment.js";
import type * as equipmentPackages from "../equipmentPackages.js";
import type * as feedback from "../feedback.js";
import type * as lib_agentProposals from "../lib/agentProposals.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_callSheetData from "../lib/callSheetData.js";
import type * as lib_documentData from "../lib/documentData.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_llm from "../lib/llm.js";
import type * as lib_plusCode from "../lib/plusCode.js";
import type * as lib_projectStatus from "../lib/projectStatus.js";
import type * as lib_sun from "../lib/sun.js";
import type * as lib_weather from "../lib/weather.js";
import type * as locations from "../locations.js";
import type * as organisations from "../organisations.js";
import type * as people from "../people.js";
import type * as accommodation from "../accommodation.js";
import type * as projectClients from "../projectClients.js";
import type * as projectCrew from "../projectCrew.js";
import type * as projectEquipment from "../projectEquipment.js";
import type * as projectFiles from "../projectFiles.js";
import type * as projects from "../projects.js";
import type * as schedule from "../schedule.js";
import type * as setMode from "../setMode.js";
import type * as shootDays from "../shootDays.js";
import type * as tools from "../tools.js";
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
  crons: typeof crons;
  dashboard: typeof dashboard;
  demoData: typeof demoData;
  distribution: typeof distribution;
  documents: typeof documents;
  equipment: typeof equipment;
  equipmentPackages: typeof equipmentPackages;
  feedback: typeof feedback;
  "lib/agentProposals": typeof lib_agentProposals;
  "lib/ai": typeof lib_ai;
  "lib/auth": typeof lib_auth;
  "lib/callSheetData": typeof lib_callSheetData;
  "lib/documentData": typeof lib_documentData;
  "lib/email": typeof lib_email;
  "lib/geocode": typeof lib_geocode;
  "lib/llm": typeof lib_llm;
  "lib/plusCode": typeof lib_plusCode;
  "lib/projectStatus": typeof lib_projectStatus;
  "lib/sun": typeof lib_sun;
  "lib/weather": typeof lib_weather;
  locations: typeof locations;
  organisations: typeof organisations;
  people: typeof people;
  accommodation: typeof accommodation;
  projectClients: typeof projectClients;
  projectCrew: typeof projectCrew;
  projectEquipment: typeof projectEquipment;
  projectFiles: typeof projectFiles;
  projects: typeof projects;
  schedule: typeof schedule;
  setMode: typeof setMode;
  shootDays: typeof shootDays;
  tools: typeof tools;
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
