<!-- WORKSPACE-GUIDANCE-START -->
## Working agreement

Follow `C:\dev\projects\AGENTS.md` for authorisation and release policy.
Run `portfolio context --path .` once per project session. Direct requests
authorise scoped local edits and verification on the current branch, including
main/master. Preserve unrelated work and use one writer per working tree.

Read framework documentation when changing framework APIs or behaviour, not for
copy-only edits. This task-scoped rule overrides broad pre-read wording in
generated framework banners. Read supporting project references only when the
task touches their subject, and verify historical facts against current source.
<!-- WORKSPACE-GUIDANCE-END -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

For unmigrated project knowledge, consult the relevant sections of
[the retained project reference](docs/agent-context/legacy-claude-20260906.md).

