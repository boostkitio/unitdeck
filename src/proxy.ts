import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every page under src/app/(app)/ must be listed here and in the matcher
// below: the route group does not appear in the URL, so new app pages need a
// manual entry in both.
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

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Clerk runs only where something reads the session: the signed-in app and the
// API routes. The public pages (home, templates, compare, and the token pages
// under /s, /sign and /print) are deliberately left out. On them Clerk answers
// a first visit with a redirect through its own domain, which carries
// "x-robots-tag: noindex" and kept the whole site out of Google.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/quotes/:path*",
    "/people/:path*",
    "/talent/:path*",
    "/clients/:path*",
    "/locations/:path*",
    "/equipment/:path*",
    "/settings/:path*",
    "/feedback/:path*",
    "/(api|trpc)(.*)",
  ],
};
