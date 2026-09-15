import {
  isLocationRelease,
  rightsClauseFor,
  type DocumentData,
} from "../../../convex/lib/documentData";

export const CLAUSE_VERSION = "uk-1.0";

function formatSignedDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-semibold">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * The single source of truth for release layout, for both kinds.
 *
 * A talent release and a location release are the same document about a
 * different subject: who or what is being released, who is producing, what
 * rights are granted, and one signature. Only the subject block differs.
 * Rendered in the composer preview and printed to PDF by headless Chromium,
 * so colours stay print-safe and no viewport units are used.
 */
export function TalentReleaseDocument({
  data,
  signature,
}: {
  data: DocumentData;
  signature?: { typedName: string; drawnImage?: string; signedAt: number };
}) {
  // A boolean for the labels, and the guard itself where the fields are read
  // — narrowing follows the call, not a variable derived from it.
  const isLocation = isLocationRelease(data);
  const clause = rightsClauseFor(data);

  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white px-[14mm] py-[16mm] font-sans text-[10pt] leading-snug text-neutral-900 print:min-h-0 print:w-auto print:bg-none! print:p-0"
      style={{
        // Where each A4 page ends. The document is 210mm wide with the same
        // margins the page box uses, so these rules fall where the PDF breaks.
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0 296.5mm, rgb(212 212 216) 296.5mm 297mm)",
      }}
    >
      <header className="border-b-2 border-neutral-900 pb-3">
        <div className="flex items-end justify-between">
          <div>
            {data.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.logoUrl}
                alt=""
                className="mb-2 h-16 w-auto object-contain"
              />
            )}
            <p className="text-[8pt] uppercase tracking-widest text-neutral-500">
              {data.productionCompany}
            </p>
            <h1 className="mt-1 text-[20pt] font-bold leading-tight">{data.productionTitle}</h1>
          </div>
          <div className="text-right">
            <p className="text-[14pt] font-bold">
              {isLocation ? "Location release" : "Talent release"}
            </p>
            <p className="text-[8pt] text-neutral-500">Clause version {CLAUSE_VERSION}</p>
          </div>
        </div>
      </header>

      <section className="mt-5 break-inside-avoid">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          {isLocation ? "Location details" : "Talent details"}
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
          {isLocationRelease(data) ? (
            <>
              <Field label="Location">{data.locationName}</Field>
              <Field label="Address">
                <span className="whitespace-pre-line">{data.address}</span>
              </Field>
              <Field label="Owner or occupier">{data.ownerName}</Field>
              {data.ownerEmail && <Field label="Email">{data.ownerEmail}</Field>}
              {data.ownerPhone && <Field label="Phone">{data.ownerPhone}</Field>}
              {data.shootDates && <Field label="Dates">{data.shootDates}</Field>}
            </>
          ) : (
            <>
              <Field label="Name">{data.talentName}</Field>
              {data.talentEmail && <Field label="Email">{data.talentEmail}</Field>}
              {data.talentPhone && <Field label="Phone">{data.talentPhone}</Field>}
              {data.agentName && (
                <Field label="Agent">
                  {data.agentName}
                  {data.agentPhone ? ` (${data.agentPhone})` : ""}
                </Field>
              )}
            </>
          )}
        </dl>
      </section>

      <section className="mt-5 break-inside-avoid">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Production details
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
          <Field label="Producer">{data.producerName}</Field>
          <Field label="Production company">{data.productionCompany}</Field>
          <Field label="Production title">{data.productionTitle}</Field>
        </dl>
      </section>

      {(data.compensation || data.additionalTerms) && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Payment
          </h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
            {data.compensation && <Field label="Compensation">{data.compensation}</Field>}
            {data.additionalTerms && (
              <Field label="Additional terms">
                <span className="whitespace-pre-line">{data.additionalTerms}</span>
              </Field>
            )}
          </dl>
        </section>
      )}

      <section className="mt-5 break-inside-avoid">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Rights grant
        </h2>
        <p className="mt-2 whitespace-pre-line text-[9pt]">{clause}</p>
      </section>

      <section className="mt-8 break-inside-avoid">
        <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
          Signature
        </h2>
        {signature ? (
          // Signature and date side by side: a signature without a date beside
          // it is half a record, and the printed copy is the record.
          <div className="mt-3 flex items-end gap-8">
            <div className="min-w-0">
              {signature.drawnImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signature.drawnImage}
                  alt="Signature"
                  className="h-16 w-auto max-w-[80mm] object-contain"
                />
              )}
              <p className="mt-1 font-serif text-[16pt] italic">{signature.typedName}</p>
              <p className="mt-1 border-t border-neutral-400 pt-1 text-[8pt] text-neutral-500">
                {isLocation ? "Owner or occupier" : "Talent"} signature
              </p>
            </div>
            <div className="shrink-0">
              <p className="font-serif text-[12pt]">{formatSignedDate(signature.signedAt)}</p>
              <p className="mt-1 border-t border-neutral-400 pt-1 text-[8pt] text-neutral-500">
                Date
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 flex items-end gap-8">
            <div>
              <div className="w-[80mm] border-b border-neutral-400" />
              <p className="mt-1 text-[8pt] text-neutral-500">
                {isLocation ? "Owner or occupier" : "Talent"} signature
              </p>
            </div>
            <div>
              <div className="w-[45mm] border-b border-neutral-400" />
              <p className="mt-1 text-[8pt] text-neutral-500">Date</p>
            </div>
          </div>
        )}
        {signature && (
          <p className="mt-3 text-[8pt] text-neutral-600">
            Signed electronically on {formatSignedDate(signature.signedAt)}.
          </p>
        )}
      </section>
    </div>
  );
}
