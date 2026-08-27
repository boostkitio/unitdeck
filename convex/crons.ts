import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Expired ephemeral tokens are invisible to reads but the rows accumulate
// forever without this. Daily at 03:15 UTC, quiet hours for a UK product.
crons.cron("delete expired tool renders", "15 3 * * *", internal.tools.cleanupExpired, {});
crons.cron(
  "delete expired call sheet render tokens",
  "15 3 * * *",
  internal.callSheets.cleanupExpiredRenderTokens,
  {}
);

// A production whose last shoot day has passed moves itself into archived
// work. Early, before anyone is looking at their list for the day.
crons.cron("archive finished productions", "30 3 * * *", internal.projects.archiveFinished, {});

export default crons;
