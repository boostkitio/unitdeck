import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { CallSheetMaker } from "@/components/marketing/call-sheet-maker";
import { BRAND, SITE_URL } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Free call sheet maker (UK) for video production",
  description:
    "Build a professional call sheet in your browser and download it as a PDF, free: call times, schedule, location with parking and nearest A&E, crew list, key contacts and safety notes.",
  alternates: { canonical: `${SITE_URL}/templates/call-sheet-template` },
};

export default function CallSheetTemplatePage() {
  return (
    <MarketingShell source="template-call-sheet">
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Free call sheet maker</h1>
      <p className="mt-4 text-neutral-600">
        A call sheet is the one document every crew member actually reads. Fill in the details
        below, watch the sheet build itself in the live preview, and download a clean,
        professional PDF: call times, schedule, location with parking and the nearest A&amp;E,
        crew list, key contacts and safety notes.
      </p>

      <div className="mt-8">
        <CallSheetMaker />
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight">
        What a good call sheet includes
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-neutral-600">
        <li>
          <strong>General call and per-person call times.</strong>{" "}The single most-checked detail
          on the sheet. Put both, prominently.
        </li>
        <li>
          <strong>Location with practicalities.</strong>{" "}Full address, a maps link, where to park
          and how to get in. For UK shoots, add a Plus Code and the nearest A&amp;E so nobody has
          to search for it in a bad moment.
        </li>
        <li>
          <strong>The schedule.</strong>{" "}Time blocks, not prose. Crew scan it; they do not read it.
        </li>
        <li>
          <strong>Crew list with phone numbers.</strong>{" "}Who is on set, what they do, how to reach
          them when they are late.
        </li>
        <li>
          <strong>Key contacts.</strong>{" "}Producer and first point of contact, names and numbers.
        </li>
        <li>
          <strong>Weather, sunrise and sunset.</strong>{" "}Decides lenses, layers and lunch timing.
        </li>
        <li>
          <strong>Safety notes.</strong>{" "}A short summary of the risk assessment, acknowledged by
          everyone before the day.
        </li>
      </ul>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">
        Or skip the typing entirely
      </h2>
      <p className="mt-3 text-neutral-600">
        This maker is powered by {BRAND.name}, where call sheets assemble themselves from your
        project: AI reads the client brief, the weather and sunrise fill in automatically, crew
        confirm on their phones and check in on the day. The waitlist form below gets you early
        access.
      </p>
    </MarketingShell>
  );
}
