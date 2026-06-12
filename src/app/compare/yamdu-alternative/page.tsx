import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { BRAND, SITE_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Yamdu alternative for corporate and branded video",
  description:
    "Yamdu manages scripted film and TV productions. Unit runs video production companies: AI call sheets straight from the client brief, live crew confirmations and per-seat pricing built for weekly shoots.",
  alternates: { canonical: `${SITE_URL}/compare/yamdu-alternative` },
};

export default function YamduAlternativePage() {
  return (
    <MarketingShell source="compare-yamdu">
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        A Yamdu alternative for companies that shoot every week
      </h1>
      <p className="mt-4 text-neutral-600">
        Yamdu is serious software for scripted film and TV: script breakdowns, stripboards,
        day-out-of-days reports and payroll time cards, trusted by broadcasters. If that is your
        world, use it. {BRAND.name} exists for a different one: corporate and branded video
        companies whose productions start with a client email, not a screenplay.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Three practical differences</h2>

      <h3 className="mt-6 text-base font-semibold">1. Your brief is not a script</h3>
      <p className="mt-2 text-neutral-600">
        Yamdu&apos;s workflow begins with importing a screenplay and breaking it down. A corporate
        producer holds an email thread and a deadline. {BRAND.name}&apos;s Brief Parser reads that
        email and proposes the project, the client and the shoot days; the producer approves and
        edits. Nothing to import, nothing to break down.
      </p>

      <h3 className="mt-6 text-base font-semibold">2. Pricing that fits weekly shoots</h3>
      <p className="mt-2 text-neutral-600">
        As of June 2026, Yamdu&apos;s entry plan is $45 per month for a single user and a single
        project, with each additional project costing another $45 per month, and the team plan is
        $265 per month (or $199 billed annually). Metering by project punishes exactly the
        companies that shoot weekly. {BRAND.name} prices per producer seat with unlimited
        projects and unlimited crew recipients.
      </p>

      <h3 className="mt-6 text-base font-semibold">3. Built to run the day, not just plan it</h3>
      <p className="mt-2 text-neutral-600">
        Sending the call sheet is where Yamdu&apos;s job largely ends and {BRAND.name}&apos;s
        keeps going: every crew member gets a personal no-login mobile page with their call time,
        maps, parking and safety notes; they confirm with one tap; the producer watches
        confirmations land in real time, chases stragglers with an AI-drafted nudge, and takes
        check-ins on the morning of the shoot. The wrap report writes itself from what actually
        happened.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Choose Yamdu if</h2>
      <p className="mt-3 text-neutral-600">
        You make scripted drama, documentaries with large crews, or episodic TV and need
        breakdowns, DOODs, budgeting and payroll in one enterprise system.
      </p>
      <h2 className="mt-6 text-xl font-semibold tracking-tight">Choose {BRAND.name} if</h2>
      <p className="mt-3 text-neutral-600">
        You run a video production company. Client briefs in, polished call sheets out, crew
        confirmed, day run, wrapped. {BRAND.name} is the operating system for that week, with AI
        doing the admin.
      </p>
    </MarketingShell>
  );
}
