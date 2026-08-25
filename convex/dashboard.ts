import { query, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireOrg } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";

export type AttentionItem = {
  // Call-sheet-derived kinds are gone: call sheets are not in use, so an
  // unsent one is not something to chase. What matters before a shoot is
  // whether the crew is booked and whether they have confirmed.
  kind: "no_crew" | "unfilled_role" | "unconfirmed_crew" | "kit_clash" | "weather_risk";
  projectId: Id<"projects">;
  projectName: string;
  // A production with no dates in the diary still has crew to chase, so both
  // of these are absent for one that has not been scheduled yet.
  shootDayId?: Id<"shootDays">;
  date?: string;
  label: string;
};

/** Case and spacing are not what makes two lines the same piece of kit. */
function itemKey(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, " ");
}

/** What to call a booking nobody is in yet. `role` is what names such a row. */
function roleName(row: Doc<"projectCrew">): string {
  const role = row.role?.trim();
  return role && role.length > 0 ? role : "A role";
}

export const attention = query({
  args: {},
  handler: async (ctx): Promise<AttentionItem[]> => {
    const { org } = await requireOrg(ctx);
    const today = new Date().toISOString().slice(0, 10);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(500);

    // Every production still on the books. Booking status is deliberately not
    // a filter: a job confirmed with the client is exactly the one whose crew
    // has to be booked and confirmed, and gating on status hid all of them.
    // Archiving is the only thing that takes a production off this list.
    const live = new Map<Id<"projects">, Doc<"projects">>();
    for (const project of projects) {
      if (!isArchived(project)) live.set(project._id, project);
    }

    // Range on the composite index: only rows from today onwards are read,
    // so a long shoot-day history can never crowd out upcoming days. Index
    // order is already ascending by date.
    const days = await ctx.db
      .query("shootDays")
      .withIndex("by_org_and_date", (q) => q.eq("orgId", org._id).gte("date", today))
      .take(500);
    const upcoming = days.filter((d) => live.has(d.projectId));

    // Crew is booked per production, not per day, so a crew problem is dated
    // by the first day it matters. Raising it per shoot day repeated the same
    // sentence for every day of the shoot.
    const firstDayByProject = new Map<Id<"projects">, Doc<"shootDays">>();
    for (const day of upcoming) {
      if (!firstDayByProject.has(day.projectId)) firstDayByProject.set(day.projectId, day);
    }

    // One read for the whole org rather than one per production.
    const crewRows = await ctx.db
      .query("projectCrew")
      .withIndex("by_org", (q) => q.eq("orgId", org._id))
      .take(4000);
    const crewByProject = new Map<Id<"projects">, Doc<"projectCrew">[]>();
    for (const row of crewRows) {
      if (!live.has(row.projectId)) continue;
      const rows = crewByProject.get(row.projectId);
      if (rows) rows.push(row);
      else crewByProject.set(row.projectId, [row]);
    }

    // Names for the people who have yet to confirm — a line saying who it is
    // can be acted on; one saying "2 of 5" cannot.
    const names = new Map<Id<"people">, string>();
    for (const rows of crewByProject.values()) {
      for (const row of rows) {
        if (row.personId === undefined || row.status === "confirmed") continue;
        if (names.has(row.personId)) continue;
        const person = await ctx.db.get(row.personId);
        names.set(row.personId, person?.name ?? "Somebody");
      }
    }

    const items: AttentionItem[] = [];

    for (const project of live.values()) {
      const day = firstDayByProject.get(project._id);
      const base = {
        projectId: project._id,
        projectName: project.name,
        shootDayId: day?._id,
        date: day?.date,
      };

      const rows = crewByProject.get(project._id) ?? [];
      if (rows.length === 0) {
        items.push({ ...base, kind: "no_crew", label: "No crew on this project yet" });
        continue;
      }

      // A line per person, because each one is a different phone call. A role
      // with nobody in it is a different job from a booked person who has not
      // said yes, and only a filled row can be confirmed.
      for (const row of rows) {
        if (row.personId === undefined) {
          items.push({
            ...base,
            kind: "unfilled_role",
            label: `${roleName(row)} still to book`,
          });
        } else if (row.status !== "confirmed") {
          // Bookings predating the status field read as pencilled.
          const name = names.get(row.personId) ?? "Somebody";
          const role = row.role?.trim();
          items.push({
            ...base,
            kind: "unconfirmed_crew",
            label: role ? `${name} (${role}) still to confirm` : `${name} still to confirm`,
          });
        }
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

    // Which days each production holds. Only productions with dates can clash
    // with one another, so this is the set the kit check works over.
    const datesByProject = new Map<Id<"projects">, Set<string>>();
    for (const day of days) {
      if (!live.has(day.projectId)) continue;
      const set = datesByProject.get(day.projectId);
      if (set) set.add(day.date);
      else datesByProject.set(day.projectId, new Set([day.date]));
    }

    // What each production wants of each thing, and which exact pieces of kit
    // it has claimed.
    const demand = new Map<
      string,
      Map<Id<"projects">, { count: number; units: Set<string> }>
    >();
    for (const row of kitRows) {
      if (!datesByProject.has(row.projectId)) continue;
      const key = itemKey(row.item);
      if (!stock.has(key)) continue; // Hired in: nothing fixed to run out of.
      const byItem =
        demand.get(key) ?? new Map<Id<"projects">, { count: number; units: Set<string> }>();
      const entry = byItem.get(row.projectId) ?? { count: 0, units: new Set<string>() };
      entry.count += row.quantity ?? 1;
      if (row.equipmentId) entry.units.add(String(row.equipmentId));
      byItem.set(row.projectId, entry);
      demand.set(key, byItem);
    }

    // How many items each production is overbooked on, and the day it bites.
    const clashCount = new Map<Id<"projects">, { count: number; date: string }>();
    for (const [key, byProject] of demand) {
      if (byProject.size < 2) continue;
      const held = stock.get(key)!;

      for (const [projectId, mine] of byProject) {
        const myDates = datesByProject.get(projectId)!;
        let clashingOn: string | null = null;
        let total = mine.count;
        let sameUnit = false;

        for (const [otherId, other] of byProject) {
          if (otherId === projectId) continue;
          const otherDates = datesByProject.get(otherId)!;
          const shared = [...myDates].filter((d) => otherDates.has(d)).sort();
          if (shared.length === 0) continue;
          total += other.count;
          if ([...other.units].some((unit) => mine.units.has(unit))) sameUnit = true;
          if (!clashingOn || shared[0] < clashingOn) clashingOn = shared[0];
        }
        if (clashingOn === null) continue;
        if (!sameUnit && total <= held) continue;

        const running = clashCount.get(projectId);
        if (running) {
          running.count++;
          if (clashingOn < running.date) running.date = clashingOn;
        } else {
          clashCount.set(projectId, { count: 1, date: clashingOn });
        }
      }
    }

    for (const [projectId, clash] of clashCount) {
      const project = live.get(projectId)!;
      const day = days.find((d) => d.projectId === projectId && d.date === clash.date);
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
    // per shoot day — and like a kit clash it is worth knowing about whatever
    // the booking status says, because rain does not care that a job is
    // confirmed.
    for (const day of upcoming) {
      if (
        day.weather?.precipitationProbability === undefined ||
        day.weather.precipitationProbability < 60
      ) {
        continue;
      }
      const project = live.get(day.projectId)!;
      items.push({
        projectId: project._id,
        projectName: project.name,
        shootDayId: day._id,
        date: day.date,
        kind: "weather_risk",
        label: `Weather risk: ${day.weather.summary}, ${day.weather.precipitationProbability}% rain`,
      });
    }

    // Soonest first: the panel is a queue of what to deal with next. Anything
    // on a production with no dates in the diary sorts to the bottom — it is
    // still work, but it is not work with a deadline.
    items.sort((a, b) => {
      if (a.date !== undefined && b.date !== undefined) {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
      } else if (a.date !== undefined) {
        return -1;
      } else if (b.date !== undefined) {
        return 1;
      }
      return a.projectName.localeCompare(b.projectName) || a.label.localeCompare(b.label);
    });
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
