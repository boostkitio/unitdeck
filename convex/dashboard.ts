import { query } from "./_generated/server";
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

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    const upcoming = days
      .filter((d) => d.date >= today && byId.has(d.projectId))
      .sort((a, b) => a.date.localeCompare(b.date));

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

// Projects in these statuses do not surface on the "this week" panel even if a
// stray future shoot day exists.
const EXCLUDED_FROM_WEEK = new Set(["archived"]);

/**
 * Shoot days in the next 7 days (today inclusive) for non-archived projects,
 * with per-day crew confirmation counts. Powers the dashboard "This week" panel.
 */
export const upcomingShootDays = query({
  args: {},
  handler: async (ctx): Promise<UpcomingShootDay[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);
    const projectById = new Map(projects.map((p) => [p._id, p]));

    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);

    const upcoming = days
      .filter((d) => d.date >= today && d.date <= horizon)
      .filter((d) => {
        const project = projectById.get(d.projectId);
        return project !== undefined && !EXCLUDED_FROM_WEEK.has(project.status);
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const result: UpcomingShootDay[] = [];
    for (const day of upcoming) {
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
  },
});
