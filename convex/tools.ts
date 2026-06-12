import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { callSheetDataValidator } from "./lib/callSheetData";

const RENDER_TTL_MS = 15 * 60 * 1000;
const MAX_JSON_LENGTH = 20000;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Public: backs the free call sheet maker. Data is ephemeral (15 minutes),
 * never attached to a tenant, and size-capped. `website` is a honeypot.
 */
export const createRender = mutation({
  args: { data: callSheetDataValidator, website: v.string() },
  handler: async (ctx, args) => {
    const token = newToken();
    // Honeypot: hand bots a token that resolves to nothing
    if (args.website.trim() !== "") return { token };
    if (JSON.stringify(args.data).length > MAX_JSON_LENGTH) {
      throw new Error("That call sheet is too large for the free tool");
    }
    if (args.data.schedule.length > 40 || args.data.crew.length > 60) {
      throw new Error("That call sheet is too large for the free tool");
    }
    await ctx.db.insert("toolRenders", {
      token,
      data: args.data,
      expiresAt: Date.now() + RENDER_TTL_MS,
    });
    return { token };
  },
});

export const getRender = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("toolRenders")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!row || row.expiresAt < Date.now()) return null;
    return { data: row.data };
  },
});
