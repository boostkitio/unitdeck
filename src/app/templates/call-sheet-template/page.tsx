import { MarketingShell } from "@/components/marketing/marketing-shell";
import { CallSheetMaker } from "@/components/marketing/call-sheet-maker";
import { JsonLd, breadcrumbList } from "@/components/marketing/json-ld";
import { BRAND } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

const PATH = "/templates/call-sheet-template";

export const metadata = pageMetadata({
  title: "Free call sheet template: fill in online, download PDF",
  description:
    "Free call sheet template for film, video and photo shoots. Fill it in online and download a PDF with call times, schedule, location, crew and safety notes.",
  path: PATH,
});

// Shown on the page and published as FAQPage structured data, so the two can
// never drift apart. Plain text only.
const FAQS = [
  {
    question: "Is this call sheet template free?",
    answer:
      "Yes. Filling in the template and previewing the sheet costs nothing and needs no account. To download the PDF you enter an email address, which also adds you to the UnitDeck waitlist.",
  },
  {
    question: "Can I get the call sheet template in Word, Google Docs or Excel?",
    answer:
      "No. This template is filled in online and downloads as a PDF rather than a Word, Google Docs or Excel file. A PDF looks the same on every phone and laptop, so the sheet your crew opens is the sheet you approved.",
  },
  {
    question: "What should a call sheet include?",
    answer:
      "The general call time and each person's own call time, the location with its address, parking and access, the day's schedule in time blocks, the crew list with phone numbers, key contacts, the nearest A&E and a short safety summary.",
  },
  {
    question: "Does it work for a photoshoot or a small corporate video shoot?",
    answer:
      "Yes. The template asks for the things any shoot needs: when to arrive, where to go, what happens when, who is there and who to ring.",
  },
  {
    question: "When should a call sheet be sent?",
    answer:
      "Usually the day before the shoot, once call times and the location are confirmed, so everyone has it the evening before. If anything changes after that, send the updated sheet and say what changed.",
  },
] as const;

const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function CallSheetTemplatePage() {
  return (
    <MarketingShell source="template-call-sheet">
      <JsonLd data={breadcrumbList([{ name: "Free call sheet template", path: PATH }])} />
      <JsonLd data={FAQ_SCHEMA} />

      <h1 className="mt-4 text-3xl font-bold tracking-tight">Free call sheet template</h1>
      <p className="mt-4 text-neutral-600">
        A free call sheet template for film, video and photo shoots that you fill in online. Add
        your details below, watch the sheet build itself in the live preview, and download a
        clean, professional PDF: call times, schedule, location with parking and the nearest
        A&amp;E, crew list, key contacts and safety notes.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Fill in your call sheet</h2>
      <div className="mt-4">
        <CallSheetMaker />
      </div>

      <h2 className="mt-12 text-xl font-semibold tracking-tight">What is a call sheet?</h2>
      <p className="mt-3 text-neutral-600">
        A call sheet is the document that tells everyone on a shoot when to arrive, where to go
        and what is happening that day. It goes to the cast and crew before each shoot day and is
        the one document every crew member actually reads, so it has to be right and it has to be
        easy to scan on a phone.
      </p>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">
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
        How to fill in the call sheet template
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-neutral-600">
        <li>
          <strong>Production.</strong>{" "}Enter the production title, your company name, the shoot
          date and the general call time.
        </li>
        <li>
          <strong>Location.</strong>{" "}Add the location name and full address, where to park and
          the nearest A&amp;E.
        </li>
        <li>
          <strong>Schedule.</strong>{" "}Add a row for each block of the day with its time and what
          is happening.
        </li>
        <li>
          <strong>Crew and key contacts.</strong>{" "}List each person with their role and phone
          number, then the people to ring if something goes wrong.
        </li>
        <li>
          <strong>Notes and safety.</strong>{" "}Add anything the crew needs to know and a short
          safety summary.
        </li>
        <li>
          <strong>Check and download.</strong>{" "}Read the live preview as your crew would, then
          download the PDF and send it.
        </li>
      </ol>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">Call sheet template questions</h2>
      <dl className="mt-3 space-y-5">
        {FAQS.map((faq) => (
          <div key={faq.question}>
            <dt className="font-semibold text-neutral-900">{faq.question}</dt>
            <dd className="mt-1 text-neutral-600">{faq.answer}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 text-xl font-semibold tracking-tight">
        Or skip the typing entirely
      </h2>
      <p className="mt-3 text-neutral-600">
        This template is powered by {BRAND.name}, where call sheets assemble themselves from your
        project: AI reads the client brief, the weather and sunrise fill in automatically, crew
        confirm on their phones and check in on the day. The waitlist form below gets you early
        access.
      </p>
    </MarketingShell>
  );
}
