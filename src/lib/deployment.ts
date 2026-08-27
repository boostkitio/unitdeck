/**
 * The Convex deployment holding real productions. Everything else - a dev
 * deployment, a preview build, somebody's own copy - is a rehearsal.
 *
 * Named here rather than read from an environment variable because the variable
 * has to be set correctly in every environment for the check to mean anything,
 * and the first time it was missed the bar appeared over a client's live jobs
 * announcing they were not real. A constant cannot be left unset.
 */
const PRODUCTION_DEPLOYMENT = "groovy-anaconda-410";

/**
 * Whether to warn that the data on screen is not the live set, and which
 * deployment it actually came from.
 *
 * One-sided on purpose: silence requires positive proof this is production, so
 * an unrecognised or unreadable URL warns. The question it answers is which
 * deployment holds the data, not where the frontend runs, because a production
 * frontend pointed at a copy is exactly the mix-up worth catching.
 */
export function devBanner(convexUrl: string | undefined): { deployment: string } | null {
  const deployment = deploymentName(convexUrl);
  if (deployment === PRODUCTION_DEPLOYMENT) return null;
  return { deployment };
}

/** The deployment's name out of its Convex URL, e.g. "opulent-peacock-325". */
function deploymentName(convexUrl: string | undefined): string {
  if (!convexUrl) return "unknown deployment";
  try {
    const { hostname } = new URL(convexUrl);
    // Matched against the whole Convex host, so a lookalike domain or a
    // "-staging" suffix cannot pass itself off as the live deployment.
    const match = /^([^.]+)\.convex\.(cloud|site)$/.exec(hostname);
    return match ? match[1] : "unknown deployment";
  } catch {
    // A URL we cannot read tells us less, not more: still warn, just vaguely.
    return "unknown deployment";
  }
}
