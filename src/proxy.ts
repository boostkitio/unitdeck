import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Every page under src/app/(app)/ must be listed here: the route group does
// not appear in the URL, so new app pages need a manual entry.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/quotes(.*)",
  "/people(.*)",
  "/talent(.*)",
  "/clients(.*)",
  "/locations(.*)",
  "/equipment(.*)",
  "/settings(.*)",
  "/feedback(.*)",
]);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Marketing pages and crawler files never pass through Clerk. With a Clerk
// development instance, Clerk answers a first page load that has no dev
// browser cookie with a 307 to *.clerk.accounts.dev, so Googlebot could not
// read any page. None of these read auth on the server (the home page reads
// the signed-in state in the browser, see app/home-auth.tsx), so they render
// the same without it. A page listed here must not call auth() or
// currentUser().
const PUBLIC_PATHS = new Set(["/", "/robots.txt", "/sitemap.xml", "/llms.txt", "/offline"]);
const PUBLIC_PREFIXES = ["/compare/", "/templates/", "/opengraph-image", "/twitter-image"];
const isPublicMarketing = (pathname: string) =>
  PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (isPublicMarketing(req.nextUrl.pathname)) return NextResponse.next();
  return clerk(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
