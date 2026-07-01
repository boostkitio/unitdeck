import type { TalentReleaseData } from "../../../convex/lib/documentData";

export const CLAUSE_VERSION = "uk-1.0";
export const RIGHTS_GRANT_CLAUSE =
  "The Talent grants the Producer the right to photograph, film and record the Talent's voice and likeness for the Production, to make copies of those recordings, and to use the Talent's name and likeness for the promotion, advertising and distribution of the Production, in all media, worldwide, in perpetuity, unless otherwise stated above. The master recordings remain the property of the Producer. The Talent confirms they are over 18 and have authority to grant these rights. This agreement is governed by the law of {{governingLaw}}.";

function formatSignedDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * The single source of truth for talent release layout. Rendered in the
 * composer preview and printed to PDF by headless Chromium. Keep colours
 * print-safe and avoid viewport-relative units.
 */
export function TalentReleaseDocument({
  data,
  signature,
}: {
  data: TalentReleaseData;
  signature?: { typedName: string; drawnImage?: string; signedAt: number };
}) {
  const clause = RIGHTS_GRANT_CLAUSE.replace("{{governingLaw}}", data.governingLaw);

  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] font-sans text-[10pt] leading-snug text-neutral-900">
      {/* Header */}
      <header className="border-b-2 border-neutral-900 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[8pt] uppercase tracking-widest text-neutral-500">
              {data.productionCompany}
            </p>
            <h1 className="mt-1 text-[20pt] font-bold leading-tight">{data.productionTitle}</h1>
          </div>
          <div className="text-right">
            <p className="text-[14pt] font-bold">Talent release</p>
            <p className="text-[8pt] text-neutral-500">Clause version {CLAUSE_VERSION}</p>
          </div>
        </div>
      </header>

      {/* Talent details */}
      <section className="mt-5">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Talent details
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
          <dt className="font-semibold">Name</dt>
          <dd>{data.talentName}</dd>
          {data.talentEmail && (
            <>
              <dt className="font-semibold">Email</dt>
              <dd>{data.talentEmail}</dd>
            </>
          )}
          {data.talentPhone && (
            <>
              <dt className="font-semibold">Phone</dt>
              <dd>{data.talentPhone}</dd>
            </>
          )}
          {data.agentName && (
            <>
              <dt className="font-semibold">Agent</dt>
              <dd>
                {data.agentName}
                {data.agentPhone ? ` (${data.agentPhone})` : ""}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Production details */}
      <section className="mt-5">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Production details
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
          <dt className="font-semibold">Producer</dt>
          <dd>{data.producerName}</dd>
          <dt className="font-semibold">Production company</dt>
          <dd>{data.productionCompany}</dd>
          <dt className="font-semibold">Production title</dt>
          <dd>{data.productionTitle}</dd>
        </dl>
      </section>

      {/* Payment */}
      {(data.compensation || data.additionalTerms) && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Payment
          </h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
            {data.compensation && (
              <>
                <dt className="font-semibold">Compensation</dt>
                <dd>{data.compensation}</dd>
              </>
            )}
            {data.additionalTerms && (
              <>
                <dt className="font-semibold">Additional terms</dt>
                <dd className="whitespace-pre-line">{data.additionalTerms}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Rights grant */}
      <section className="mt-5">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Rights grant
        </h2>
        <p className="mt-2 text-[9pt]">{clause}</p>
      </section>

      {/* Signature */}
      <section className="mt-8">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Signature
        </h2>
        {signature ? (
          <div className="mt-3">
            {signature.drawnImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signature.drawnImage}
                alt="Signature"
                className="h-16 w-auto max-w-[80mm] object-contain"
              />
            )}
            <p className="mt-1 font-serif text-[16pt] italic">{signature.typedName}</p>
            <p className="mt-1 text-[8.5pt] text-neutral-600">
              Signed electronically on {formatSignedDate(signature.signedAt)}
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <div className="w-[80mm] border-b border-neutral-400" />
            <p className="mt-1 text-[8pt] text-neutral-500">Talent signature</p>
          </div>
        )}
      </section>
    </div>
  );
}
