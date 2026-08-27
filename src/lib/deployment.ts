/**
 * Whether to warn that the data on screen is not real, and which deployment it
 * came from.
 *
 * The test is deliberately one-sided: silence requires an explicit declaration
 * of production, and everything else warns. A typo therefore puts a red bar in
 * front of a real user, which somebody reports within the hour; the opposite
 * default hides the bar on a developer's machine, and nobody finds out until a
 * production has been planned against data that was never there.
 *
 * Deriving this from the Convex URL rather than the hosting environment is the
 * point. The question the bar answers is which deployment holds the data, not
 * where the frontend runs, and a production frontend pointed at a dev backend
 * is exactly the mix-up worth catching.
 */
export function devBanner(
  convexUrl: string | undefined,
  appEnv: string | undefined
): { deployment: string } | null {
  if (appEnv === "production") return null;
  return { deployment: deploymentName(convexUrl) };
}

/** The deployment's name out of its Convex URL, e.g. "opulent-peacock-325". */
function deploymentName(convexUrl: string | undefined): string {
  if (!convexUrl) return "unknown deployment";
  try {
    return new URL(convexUrl).hostname.split(".")[0] || "unknown deployment";
  } catch {
    // A URL we cannot read tells us less, not more: still warn, just vaguely.
    return "unknown deployment";
  }
}
