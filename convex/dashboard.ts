import { query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { needsAttention } from "./lib/projectStatus";
import { Doc, Id } from "./_generated/dataModel";

export type AttentionItem = {
  // Call-sheet-derived kinds are gone: call sheets are not in use, so an
  // unsent one is not something to chase. What matters before a shoot is
  // whether the crew is confirmed.
  kind: "no_crew" | "unfilled_roles" | "unconfirmed_crew" | "kit_clash" | "weather_risk";
  projectId: Id<"projects">;
  projectName: string;
  shootDayId: Id<"shootDays">;
  date: string;
  label: string;
};

// Only unconfirmed work is chased: a confirmed booking is not "needing
// attention" just because its call sheet has not gone out yet.
function chases(status: string): boolean {
  return needsAttention(status);
}

/** Case and spacing are not what makes two lines the same piece of kit. */
function itemKey(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, " ");
}

export const attention = query({
  args: {},
  handler: async (ctx): Promise<AttentionItem[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(200);

    // Archiving keeps the booking status, so an archived project can still be
    // "pencilled" — it must be excluded here or it produces attention items
    // for a production that no longer appears anywhere in the app.
    const byId = new Map(
      projects.filter((p) => !isArchived(p) && chases(p.status)).map((p) => [p._id, p])
    );

    // Range on the composite index: only rows from today onwards are read,
    // so a long shoot-day history can never crowd out upcoming days. Index
    // order is already ascending by date.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org_and_date", (q) => q.eq("orgId", org._id).gte("date", today))
      .take(500);
    const upcoming = days.filter((d) => byId.has(d.projectId));


    // Crew is booked per project rather than per day, so it is resolved once
    // per project and reused across that project's shoot days.
    const crewByProject = new Map<
      Id<"projects">,
      { total: number; unfilled: number; filled: number; confirmed: number }
    >();
    async function crewFor(projectId: Id<"projects">) {
      const cached = crewByProject.get(projectId);
      if (cached) return cached;
      const rows = await ctx.db
        .query("projectCrew")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .take(200);
      // A role with nobody in it is a different problem from a booked person
      // who has not confirmed, and only the filled ones can be confirmed.
      const filledRows = rows.filter((r) => r.personId !== undefined);
      const counts = {
        total: rows.length,
        unfilled: rows.length - filledRows.length,
        filled: filledRows.length,
        // Bookings predating the status field read as pencilled.
        confirmed: filledRows.filter((r) => r.status === "confirmed").length,
      };
      crewByProject.set(projectId, counts);
      return counts;
    }

    const items: AttentionItem[] = [];

    // Crew is booked per production, not per day, so it is reported once per
    // production against the first day it matters. Raising it per shoot day
    // repeated the same sentence for every day of the shoot and counted a
    // single unbooked production five times over.
    const firstDayByProject = new Map<Id<"projects">, Doc<"shootDays">>();
    for (const day of upcoming) {
      if (!firstDayByProject.has(day.projectId)) firstDayByProject.set(day.projectId, day);
    }

    for (const [projectId, day] of firstDayByProject) {
      const project = byId.get(projectId)!;
      const base = {
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: day.date,
      };

      const crew = await crewFor(projectId);
      if (crew.total === 0) {
        items.push({ ...base, kind: "no_crew", label: "No crew on this project yet" });
        continue;
      }
      if (crew.unfilled > 0) {
        items.push({
          ...base,
          kind: "unfilled_roles",
          label: `${crew.unfilled} role${crew.unfilled === 1 ? "" : "s"} still to book`,
        });
      }
      if (crew.filled > 0 && crew.confirmed < crew.filled) {
        const outstanding = crew.filled - crew.confirmed;
        items.push({
          ...base,
          kind: "unconfirmed_crew",
          label: `${outstanding} of ${crew.filled} crew still to confirm`,
        });
      }
    }

    // Kit booked on two productions at once. Counted the same way the project
    // page counts it, so the dashboard and the project never disagree — and
    // raised once per production as a count, because twenty lines all saying
    // the same thing about the same shoot is not twenty problems.
    const kitRows = await ctx.db
      .query("projectEquipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);
    const inventory = await ctx.db
      .query("equipment")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(5000);

    const stock = new Map<string, number>();
    for (const kit of inventory) {
      if (kit.archived) continue;
      const key = itemKey(kit.item);
      stock.set(key, (stock.get(key) ?? 0) + 1);
    }

    // Every production with an upcoming day, and the days it holds. Unlike the
    // crew checks this is not limited to unconfirmed bookings: a confirmed
    // shoot double-booked on a camera is exactly the problem worth raising.
    const liveProjects = new Map<string, Doc<"projects">>();
    for (const project of projects) {
      if (isArchived(project)) continue;
      liveProjects.set(String(project._id), project);
    }
    const datesByProject = new Map<string, Set<string>>();
    for (const day of days) {
      if (!liveProjects.has(String(day.projectId))) continue;
      const key = String(day.projectId);
      const set = datesByProject.get(key);
      if (set) set.add(day.date);
      else datesByProject.set(key, new Set([day.date]));
    }

    // What each production wants of each thing, and which exact pieces of kit
    // it has claimed.
    const demand = new Map<string, Map<string, { count: number; units: Set<string> }>>();
    for (const row of kitRows) {
      const projectKey = String(row.projectId);
      if (!datesByProject.has(projectKey)) continue;
      const key = itemKey(row.item);
      if (!stock.has(key)) continue; // Hired in: nothing fixed to run out of.
      const byItem = demand.get(key) ?? new Map<string, { count: number; units: Set<string> }>();
      const entry = byItem.get(projectKey) ?? { count: 0, units: new Set<string>() };
      entry.count += row.quantity ?? 1;
      if (row.equipmentId) entry.units.add(String(row.equipmentId));
      byItem.set(projectKey, entry);
      demand.set(key, byItem);
    }

    // How many items each production is overbooked on, and the day it bites.
    const clashCount = new Map<string, { count: number; date: string }>();
    for (const [key, byProject] of demand) {
      if (byProject.size < 2) continue;
      const held = stock.get(key)!;

      for (const [projectKey, mine] of byProject) {
        const myDates = datesByProject.get(projectKey)!;
        let clashingOn: string | null = null;
        let total = mine.count;
        let sameUnit = false;

        for (const [otherKey, other] of byProject) {
          if (otherKey === projectKey) continue;
          const otherDates = datesByProject.get(otherKey)!;
          const shared = [...myDates].filter((d) => otherDates.has(d)).sort();
          if (shared.length === 0) continue;
          total += other.count;
          if ([...other.units].some((unit) => mine.units.has(unit))) sameUnit = true;
          if (!clashingOn || shared[0] < clashingOn) clashingOn = shared[0];
        }
        if (clashingOn === null) continue;
        if (!sameUnit && total <= held) continue;

        const running = clashCount.get(projectKey);
        if (running) {
          running.count++;
          if (clashingOn < running.date) running.date = clashingOn;
        } else {
          clashCount.set(projectKey, { count: 1, date: clashingOn });
        }
      }
    }

    for (const [projectKey, clash] of clashCount) {
      const project = liveProjects.get(projectKey)!;
      const day = days.find(
        (d) => String(d.projectId) === projectKey && d.date === clash.date
      );
      if (!day) continue;
      items.push({
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: clash.date,
        kind: "kit_clash",
        label: `${clash.count} item${clash.count === 1 ? "" : "s"} double-booked with another shoot`,
      });
    }

    // Weather is the one thing that genuinely differs day by day, so it stays
    // per shoot day.
    for (const day of upcoming) {
      if (
        day.weather?.precipitationProbability === undefined ||
        day.weather.precipitationProbability < 60
      ) {
        continue;
      }
      const project = byId.get(day.projectId)!;
      items.push({
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: day.date,
        kind: "weather_risk",
        label: `Weather risk: ${day.weather.summary}, ${day.weather.precipitationProbability}% rain`,
      });
    }

    // Soonest first: the panel is a queue of what to deal with next.
    items.sort((a, b) => a.date.localeCompare(b.date));
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

// Archived projects do not surface on the dashboard schedule even if a stray
// future shoot day exists. Legacy rows are still archived via their status.
function isArchived(project: Doc<"projects">): boolean {
  return project.archived === true || project.status === "archived";
}

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
    return project !== undefined && !isArchived(project);
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
