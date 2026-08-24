import { query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";

export type AttentionItem = {
  kind:
    | "call_sheet_not_sent"
    | "unconfirmed_crew"
    | "declined_crew"
    | "failed_sends"
    | "no_crew"
    | "no_schedule"
    | "no_locations"
    | "weather_risk";
  projectId: Id<"projects">;
  projectName: string;
  shootDayId: Id<"shootDays">;
  date: string;
  label: string;
};

const ACTIVE = new Set(["brief", "pre_production", "shooting", "post"]);

export const attention = query({
  args: {},
  handler: async (ctx): Promise<AttentionItem[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(200);
    const byId = new Map(projects.filter((p) => ACTIVE.has(p.status)).map((p) => [p._id, p]));

    // Range on the composite index: only rows from today onwards are read,
    // so a long shoot-day history can never crowd out upcoming days. Index
    // order is already ascending by date.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org_and_date", (q) => q.eq("orgId", org._id).gte("date", today))
      .take(500);
    const upcoming = days.filter((d) => byId.has(d.projectId));

    const items: AttentionItem[] = [];
    for (const day of upcoming) {
      const project = byId.get(day.projectId)!;
      const base = {
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: day.date,
      };

      const versions = await ctx.db
        .query("callSheets")
        .withIndex("by_shoot_day_and_version", (q) => q.eq("shootDayId", day._id))
        .order("desc")
        .take(20);
      const sent = versions.find((s) => s.status === "sent") ?? null;
      const latest = versions[0] ?? null;
      const data = latest?.data;

      if (!sent) {
        items.push({ ...base, kind: "call_sheet_not_sent", label: "Call sheet not sent yet" });
      }
      if (data && data.crew.length === 0) {
        items.push({ ...base, kind: "no_crew", label: "No crew on the call sheet" });
      }
      if (data && data.schedule.length === 0) {
        items.push({ ...base, kind: "no_schedule", label: "No schedule blocks yet" });
      }
      if (data && data.locations.length === 0) {
        items.push({ ...base, kind: "no_locations", label: "No locations attached" });
      }
      if (
        day.weather?.precipitationProbability !== undefined &&
        day.weather.precipitationProbability >= 60
      ) {
        items.push({
          ...base,
          kind: "weather_risk",
          label: `Weather risk: ${day.weather.summary}, ${day.weather.precipitationProbability}% rain`,
        });
      }

      const recipients: Doc<"recipients">[] = await ctx.db
        .query("recipients")
        .withIndex("by_shoot_day", (q) => q.eq("shootDayId", day._id))
        .take(200);
      const unconfirmed = recipients.filter(
        (r) => r.status === "sent" || r.status === "viewed" || r.status === "pending"
      );
      const declined = recipients.filter((r) => r.status === "declined");
      const failed = recipients.filter((r) => r.status === "failed");
      if (sent && unconfirmed.length > 0) {
        items.push({
          ...base,
          kind: "unconfirmed_crew",
          label: `${unconfirmed.length} of ${recipients.length} crew not confirmed`,
        });
      }
      if (declined.length > 0) {
        items.push({
          ...base,
          kind: "declined_crew",
          label: `${declined.map((r) => r.name).join(", ")} declined`,
        });
      }
      if (failed.length > 0) {
        items.push({
          ...base,
          kind: "failed_sends",
          label: `Email failed for ${failed.map((r) => r.name).join(", ")}`,
        });
      }
    }
    return items;
  },
});

export type UpcomingShootDay = {
  shootDayId: Id<"shootDays">;
  projectId: Id<"projects">;
  projectName: string;
  date: string;
  label?: string;
  locationName: string | null;
  confirmed: number;
  total: number;
};

// Projects in these statuses do not surface on the dashboard schedule even if
// a stray future shoot day exists.
const EXCLUDED_FROM_WEEK = new Set(["archived"]);

/**
 * Shoot days between two "YYYY-MM-DD" dates (both inclusive) for non-archived
 * projects, with per-day crew confirmation counts. Shared by the 7-day panel
 * and the month calendar.
 */
async function shootDaysBetween(
  ctx: QueryCtx,
  orgId: Id<"organisations">,
  from: string,
  to: string
): Promise<UpcomingShootDay[]> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .take(500);
  const projectById = new Map(projects.map((p) => [p._id, p]));

  const days = await ctx.db
    .query("shootDays")
    .withIndex("by_org_and_date", (q) =>
      q.eq("orgId", orgId).gte("date", from).lte("date", to)
    )
    .take(500);

  const visible = days.filter((d) => {
    const project = projectById.get(d.projectId);
    return project !== undefined && !EXCLUDED_FROM_WEEK.has(project.status);
  });

  const result: UpcomingShootDay[] = [];
  for (const day of visible) {
    const project = projectById.get(day.projectId)!;
    const recipients = await ctx.db
      .query("recipients")
      .withIndex("by_shoot_day", (q) => q.eq("shootDayId", day._id))
      .take(300);
    const confirmed = recipients.filter((r) => r.status === "confirmed").length;
    const firstLocation =
      day.locationIds.length > 0 ? await ctx.db.get(day.locationIds[0]) : null;
    result.push({
      shootDayId: day._id,
      projectId: project._id,
      projectName: project.name,
      date: day.date,
      label: day.label,
      locationName: firstLocation?.name ?? null,
      confirmed,
      total: recipients.length,
    });
  }
  return result;
}

/**
 * Shoot days in the next 7 days (today inclusive). Powers the dashboard stat
 * tile and hero summary line.
 */
export const upcomingShootDays = query({
  args: {},
  handler: async (ctx): Promise<UpcomingShootDay[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return await shootDaysBetween(ctx, org._id, today, horizon);
  },
});

/**
 * Shoot days in an arbitrary date window. Powers the month calendar, which
 * fetches one month at a time as the user navigates.
 */
export const shootDaysInRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args): Promise<UpcomingShootDay[]> => {
    const { org } = await requireOrg(ctx);
    if (args.from > args.to) throw new Error("`from` must not be after `to`");
    return await shootDaysBetween(ctx, org._id, args.from, args.to);
  },
});
