import { mutation } from "./_generated/server";
import { v } from "convex/values";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const join = mutation({
  args: { email: v.string(), source: v.string(), website: v.string() },
  handler: async (ctx, args) => {
    // Honeypot: real users never fill the hidden "website" field
    if (args.website.trim() !== "") return null;
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address");
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) return null;
    await ctx.db.insert("waitlist", { email, source: args.source.slice(0, 50) });
    return null;
  },
});
