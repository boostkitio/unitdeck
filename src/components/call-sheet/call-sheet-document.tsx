import type { CallSheetData } from "../../../convex/lib/callSheetData";
import { groupEquipmentBySupplier, callStrip } from "./format";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The single source of truth for call sheet layout. Rendered in the composer
 * preview and printed to PDF by headless Chromium. Keep colours print-safe
 * and avoid viewport-relative units.
 */
export function CallSheetDocument({
  data,
  versionLabel,
}: {
  data: CallSheetData;
  versionLabel?: string;
}) {
  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white p-[14mm] font-sans text-[10pt] leading-snug text-neutral-900">
      {data.confidential && (
        <p className="mb-3 text-center text-[8pt] font-bold uppercase tracking-wide text-red-600">
          Confidential document. Do not misplace. Dispose of securely.
        </p>
      )}
      {/* Header */}
      <header className="border-b-2 border-neutral-900 pb-3">
        <div className="flex items-end justify-between">
          <div>
            {data.branding?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.branding.logoUrl}
                alt=""
                className="mb-2 h-10 w-auto object-contain"
              />
            )}
            <p className="text-[8pt] uppercase tracking-widest text-neutral-500">
              {data.productionCompany}
              {data.clientName ? ` for ${data.clientName}` : ""}
            </p>
            <h1 className="mt-1 text-[20pt] font-bold leading-tight">{data.title}</h1>
          </div>
          <div className="text-right">
            <p className="text-[14pt] font-bold">Call sheet</p>
            {versionLabel && <p className="text-[8pt] text-neutral-500">{versionLabel}</p>}
          </div>
        </div>
        <div className="mt-3 flex justify-between text-[11pt]">
          <p className="font-semibold">{formatDate(data.date)}</p>
          <div className="flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-right">
            {callStrip(data).map((ct) => (
              <span key={ct.id}>
                <span className="font-semibold">{ct.label}: </span>
                {ct.time}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Day facts strip */}
      {(data.weatherSummary || data.sunrise || data.sunset) && (
        <div className="mt-3 flex gap-6 rounded border border-neutral-300 px-3 py-2 text-[9pt]">
          {data.weatherSummary && <span>Weather: {data.weatherSummary}</span>}
          {data.sunrise && <span>Sunrise: {data.sunrise}</span>}
          {data.sunset && <span>Sunset: {data.sunset}</span>}
        </div>
      )}

      {/* Locations */}
      {data.locations.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Locations
          </h2>
          <div className="mt-2 space-y-2">
            {data.locations.map((loc, i) => (
              <div key={loc.id} className="flex gap-3">
                <span className="font-bold">{i + 1}.</span>
                <div>
                  <p className="font-semibold">{loc.name}</p>
                  <p className="whitespace-pre-line">{loc.address}</p>
                  <p className="text-[8.5pt] text-neutral-600">
                    {loc.w3w && <span className="mr-3">{loc.w3w}</span>}
                    {loc.parkingNotes && <span className="mr-3">Parking: {loc.parkingNotes}</span>}
                  </p>
                  {(loc.satNav || loc.publicTransport) && (
                    <p className="text-[8.5pt] text-neutral-600">
                      {loc.satNav && <span className="mr-3">Sat nav: {loc.satNav}</span>}
                      {loc.publicTransport && <span>Transport: {loc.publicTransport}</span>}
                    </p>
                  )}
                  {(loc.nearestHospital || loc.nearestPoliceStation) && (
                    <p className="text-[8.5pt] text-neutral-600">
                      In an emergency call 999.
                      {loc.nearestHospital && <span className="ml-2">Nearest A&amp;E: {loc.nearestHospital}.</span>}
                      {loc.nearestPoliceStation && (
                        <span className="ml-2">Nearest police: {loc.nearestPoliceStation}.</span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Schedule */}
      {data.schedule.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Schedule
          </h2>
          <table className="mt-2 w-full border-collapse">
            <tbody>
              {data.schedule.map((block) => (
                <tr key={block.id} className="border-b border-neutral-200">
                  <td className="w-28 py-1.5 pr-3 align-top font-semibold whitespace-nowrap">
                    {block.start}
                    {block.end ? ` – ${block.end}` : ""}
                  </td>
                  <td className="py-1.5 align-top">
                    <p className="font-medium">{block.title}</p>
                    {block.notes && <p className="text-[8.5pt] text-neutral-600">{block.notes}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Crew */}
      {data.crew.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {data.crewSectionTitle ?? "Crew"}
          </h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="py-1 pr-2 font-semibold">Name</th>
                <th className="py-1 pr-2 font-semibold">Role</th>
                <th className="py-1 pr-2 font-semibold">Call</th>
                <th className="py-1 pr-2 font-semibold">Phone</th>
                <th className="py-1 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.crew.map((row) => (
                <tr key={row.id} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-2 font-medium">{row.name}</td>
                  <td className="py-1.5 pr-2">{row.role}</td>
                  <td className="py-1.5 pr-2 font-semibold">{row.callTime}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{row.phone ?? ""}</td>
                  <td className="py-1.5 text-[8.5pt] text-neutral-600">{row.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(data.contactSections ?? []).map((section) => (
        <section key={section.id} className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {section.title}
          </h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="py-1 pr-2 font-semibold">Role</th>
                <th className="py-1 pr-2 font-semibold">Name</th>
                <th className="py-1 pr-2 font-semibold">Reports to</th>
                <th className="py-1 pr-2 font-semibold">Phone</th>
                <th className="py-1 pr-2 font-semibold">Email</th>
                <th className="py-1 font-semibold">Call</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-2">{r.role}</td>
                  <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-2 text-neutral-600">{r.reportsTo ?? ""}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.phone ?? ""}</td>
                  <td className="py-1.5 pr-2">{r.email ?? ""}</td>
                  <td className="py-1.5 font-semibold">{r.callTime ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {/* Key contacts */}
      {data.contacts.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Key contacts
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1">
            {data.contacts.map((c) => (
              <p key={c.id}>
                <span className="font-semibold">{c.name}</span> ({c.role}) {c.phone}
              </p>
            ))}
          </div>
        </section>
      )}

      {data.camera &&
        (data.camera.recordingFormat ||
          data.camera.frameRate ||
          data.camera.aspectRatios ||
          data.camera.namingConvention ||
          data.camera.otherNotes) && (
          <section className="mt-5">
            <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
              Camera
            </h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[9pt]">
              {data.camera.recordingFormat && (<><dt className="font-semibold">Recording format</dt><dd>{data.camera.recordingFormat}</dd></>)}
              {data.camera.frameRate && (<><dt className="font-semibold">Frame rate</dt><dd>{data.camera.frameRate}</dd></>)}
              {data.camera.aspectRatios && (<><dt className="font-semibold">Aspect ratios</dt><dd>{data.camera.aspectRatios}</dd></>)}
              {data.camera.namingConvention && (<><dt className="font-semibold">Naming convention</dt><dd>{data.camera.namingConvention}</dd></>)}
              {data.camera.otherNotes && (<><dt className="font-semibold">Other notes</dt><dd>{data.camera.otherNotes}</dd></>)}
            </dl>
          </section>
        )}

      {data.equipment && data.equipment.length > 0 && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Equipment
          </h2>
          <div className="mt-2 space-y-2 text-[9pt]">
            {groupEquipmentBySupplier(data.equipment).map((group) => (
              <div key={group.supplier ?? "other"}>
                <p className="font-semibold">{group.supplier ?? "Other"}</p>
                <ul className="ml-4 list-disc">
                  {group.items.map((it) => (
                    <li key={it.id}>{it.item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notes + safety */}
      {data.notes && (
        <section className="mt-5">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Notes
          </h2>
          <p className="mt-2 whitespace-pre-line">{data.notes}</p>
        </section>
      )}
      {data.safetyNotes && (
        <section className="mt-5 rounded border-2 border-amber-500 bg-amber-50 p-3">
          <h2 className="text-[9pt] font-bold uppercase tracking-widest text-amber-800">
            Safety
          </h2>
          <p className="mt-1 whitespace-pre-line">{data.safetyNotes}</p>
        </section>
      )}

      {data.invoicing &&
        (data.invoicing.legalName ||
          data.invoicing.companyNumber ||
          data.invoicing.vatNumber ||
          data.invoicing.invoiceEmail ||
          data.invoicing.receiptsNote) && (
          <section className="mt-5 border-t border-neutral-300 pt-2 text-[8pt] text-neutral-600">
            <p className="font-semibold uppercase tracking-widest">Invoicing</p>
            <p>
              {[data.invoicing.legalName,
                data.invoicing.companyNumber && `Company no. ${data.invoicing.companyNumber}`,
                data.invoicing.vatNumber && `VAT ${data.invoicing.vatNumber}`,
                data.invoicing.invoiceEmail && `Invoices to ${data.invoicing.invoiceEmail}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {data.invoicing.receiptsNote && <p>{data.invoicing.receiptsNote}</p>}
          </section>
        )}
    </div>
  );
}
