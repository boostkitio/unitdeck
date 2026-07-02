import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every page under src/app/(app)/ must be listed here: the route group does
// not appear in the URL, so new app pages need a manual entry.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/projects(.*)",
  "/people(.*)",
  "/clients(.*)",
  "/locations(.*)",
  "/settings(.*)",
  "/feedback(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
