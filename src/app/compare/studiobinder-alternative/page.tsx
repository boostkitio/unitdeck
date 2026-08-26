import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { BRAND, SITE_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "StudioBinder alternative for video production companies",
  description:
    "Why corporate and branded video production companies are choosing Unit over StudioBinder: AI call sheets from the client brief, live crew confirmations, unlimited guests and pixel-perfect PDFs.",
  alternates: { canonical: `${SITE_URL}/compare/studiobinder-alternative` },
};

export default function StudioBinderAlternativePage() {
  return (
    <MarketingShell source="compare-studiobinder">
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        A StudioBinder alternative built for video production companies
      </h1>
      <p className="mt-4 text-neutral-600">
        StudioBinder is a fine tool for planning a film shoot. {BRAND.name} is built for the
        companies that shoot every week: corporate, branded and commercial video producers who
        live between client briefs, call sheets and crew confirmations.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Where the two differ</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-300 text-left">
              <th className="py-2 pr-4 font-semibold">What matters on a shoot</th>
              <th className="py-2 pr-4 font-semibold">StudioBinder</th>
              <th className="py-2 font-semibold">{BRAND.name}</th>
            </tr>
          </thead>
          <tbody className="align-top text-neutral-700">
            <tr className="border-b border-neutral-100">
              <td className="py-3 pr-4 font-medium">Starting point</td>
              <td className="py-3 pr-4">Projects, shot lists and stripboards you build by hand</td>
              <td className="py-3">
                Paste the client email; AI proposes the project, client and shoot days for you to
                approve
              </td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-3 pr-4 font-medium">Call sheet PDFs</td>
              <td className="py-3 pr-4">
                Producers have reported exported PDFs not matching the on-screen layout
              </td>
              <td className="py-3">
                The PDF is printed from the same component as the preview, so they cannot disagree
              </td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-3 pr-4 font-medium">Losing work</td>
              <td className="py-3 pr-4">Users have reported losing pages and edits</td>
              <td className="py-3">
                Every call sheet version is kept; restoring an old version never destroys a newer
                one
              </td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-3 pr-4 font-medium">Crew responses</td>
              <td className="py-3 pr-4">Send limits apply on lower plans</td>
              <td className="py-3">
                Unlimited recipients on every plan; live confirmed/declined tracking and an
                AI-drafted chase for stragglers
              </td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-3 pr-4 font-medium">On the day</td>
              <td className="py-3 pr-4">Crew get a PDF</td>
              <td className="py-3">
                Crew get a personal mobile page: call time, maps, parking, nearest A&amp;E, safety
                acknowledgement and on-set check-in, no login needed
              </td>
            </tr>
            <tr>
              <td className="py-3 pr-4 font-medium">UK shoots</td>
              <td className="py-3 pr-4">US-centric</td>
              <td className="py-3">
                Plus Codes, sunrise and sunset, UK weather and nearest A&amp;E on every sheet
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">The honest bit</h2>
      <p className="mt-3 text-neutral-600">
        If the work is scripted film or TV with stripboards, shot lists and scene breakdowns,
        StudioBinder has features {BRAND.name} deliberately does not. {BRAND.name} is for
        production companies whose week looks like: brief lands, crew booked, call sheet out,
        shoot, wrap, invoice, repeat. One workflow, done properly, with AI doing the data entry.
      </p>
    </MarketingShell>
  );
}
