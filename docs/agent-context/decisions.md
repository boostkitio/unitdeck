# Project decisions

Record durable, repository-safe technical decisions here. Include date,
decision, evidence, consequences, and superseded decision where applicable.
Do not store credentials or private client/commercial notes.

## 2026-10-07: Clerk does not run on public pages

Decision: the proxy matcher in `src/proxy.ts` lists only the signed-in app
routes and the API routes. Public pages (home, templates, compare, and the
token pages under `/s`, `/sign` and `/print`) are served without Clerk, and the
home page works out the signed-in state in the browser.

Evidence: with Clerk on every route, a first visit to any public page was
redirected through the Clerk domain, whose response carries
`x-robots-tag: noindex, nofollow`. Search Console reported the home page as
blocked by an HTTP header and nothing was indexed.

Consequences: a new page under `src/app/(app)/` needs an entry in both lists in
`src/proxy.ts`. A public page must not call `auth()` on the server.
