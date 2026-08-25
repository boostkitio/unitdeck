import type { CallSheetData, LocationEntry } from "../../../convex/lib/callSheetData";
import { groupEquipmentBySupplier, callStrip } from "./format";
import { EmailLink, PhoneLink } from "@/components/contact-link";

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
            {/* Where it is, right under what it is. Anyone glancing at the top
                of a call sheet is looking for one of those two things. */}
            {data.locations[0] && (
              <p className="mt-0.5 text-[8.5pt] text-neutral-600">
                <span className="font-semibold">{data.locations[0].name}</span>
                {data.locations[0].address && (
                  <span> · {data.locations[0].address.replace(/\s*\n\s*/g, ", ")}</span>
                )}
                {data.locations.length > 1 && (
                  <span> · +{data.locations.length - 1} more below</span>
                )}
              </p>
            )}
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

      {/* Schedule */}
      {data.schedule.length > 0 && (
        <section className="mt-5 break-inside-avoid">
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
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {data.crewSectionTitle ?? "Crew"}
          </h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="w-[24%] py-1 pr-2 font-semibold">Name</th>
                <th className="w-[24%] py-1 pr-2 font-semibold">Role</th>
                <th className="w-14 py-1 pr-2 font-semibold">Call</th>
                <th className="w-[22%] py-1 pr-2 font-semibold">Phone</th>
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
        <section key={section.id} className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {section.title}
          </h2>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="w-[22%] py-1 pr-2 font-semibold">Role</th>
                <th className="w-[22%] py-1 pr-2 font-semibold">Name</th>
                <th className="w-[20%] py-1 pr-2 font-semibold">Phone</th>
                <th className="py-1 pr-2 font-semibold">Email</th>
                <th className="w-14 py-1 font-semibold">Call</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-2">{r.role}</td>
                  <td className="py-1.5 pr-2 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {/* Blank fallback: this also renders to PDF, where a
                        placeholder dot would be noise on the printed sheet. */}
                    <PhoneLink phone={r.phone} fallback="" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <EmailLink email={r.email} fallback="" />
                  </td>
                  <td className="py-1.5 font-semibold">{r.callTime ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {/* Locations */}
      {data.locations.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {data.locations.length === 1 ? "Location" : "Locations"}
          </h2>
          <div className="mt-2 space-y-3">
            {data.locations.map((loc, i) => (
              <div key={loc.id} className="flex gap-3 break-inside-avoid">
                {/* The map beside the getting-there and emergency detail, so
                    the two are read together rather than a page apart. */}
                <LocationMap location={loc} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {data.locations.length > 1 && <span className="mr-1">{i + 1}.</span>}
                    {loc.name}
                  </p>
                  <p className="whitespace-pre-line">{loc.address}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[8.5pt] text-neutral-600">
                    {loc.w3w && (
                      <>
                        <dt className="font-semibold">what3words</dt>
                        <dd>{loc.w3w}</dd>
                      </>
                    )}
                    {loc.satNav && (
                      <>
                        <dt className="font-semibold">Sat nav</dt>
                        <dd>{loc.satNav}</dd>
                      </>
                    )}
                    {loc.parkingNotes && (
                      <>
                        <dt className="font-semibold">Parking</dt>
                        <dd>{loc.parkingNotes}</dd>
                      </>
                    )}
                    {loc.publicTransport && (
                      <>
                        <dt className="font-semibold">Transport</dt>
                        <dd>{loc.publicTransport}</dd>
                      </>
                    )}
                    {loc.nearestHospital && (
                      <>
                        <dt className="font-semibold">Nearest A&amp;E</dt>
                        <dd>{loc.nearestHospital}</dd>
                      </>
                    )}
                    {loc.nearestPoliceStation && (
                      <>
                        <dt className="font-semibold">Nearest police</dt>
                        <dd>{loc.nearestPoliceStation}</dd>
                      </>
                    )}
                  </dl>
                  <p className="mt-1 text-[8.5pt] font-semibold text-neutral-700">
                    In an emergency call 999.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Key contacts */}
      {data.contacts.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Key contacts
          </h2>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1">
            {data.contacts.map((c) => (
              <p key={c.id}>
                <span className="font-semibold">{c.name}</span> ({c.role}){" "}
                <PhoneLink phone={c.phone} fallback="" />
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
          <section className="mt-5 break-inside-avoid">
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
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Equipment
          </h2>
          <table className="mt-2 w-full border-collapse text-left text-[9pt]">
            <thead>
              <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
                <th className="w-40 py-1 pr-2 font-semibold">Department</th>
                <th className="py-1 font-semibold">Item</th>
              </tr>
            </thead>
            <tbody>
              {groupEquipmentBySupplier(data.equipment).map((group) =>
                group.items.map((it, i) => (
                  <tr key={it.id} className="border-b border-neutral-200">
                    {/* The department is written once against the run it
                        heads, the way a kit list is actually read. */}
                    <td className="py-1 pr-2 align-top font-semibold">
                      {i === 0 ? (group.supplier ?? "Other") : ""}
                    </td>
                    <td className="py-1 align-top">{it.item}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Notes + safety */}
      {data.notes && (
        <section className="mt-5 break-inside-avoid">
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

/**
 * A printed map of the location.
 *
 * Google's static map is an image rather than an embed, which is what a sheet
 * that will be printed and handed round needs. It wants a browser key, and
 * without one the panel says so plainly rather than printing a broken image
 * or a grey box nobody can explain.
 */
function LocationMap({ location }: { location: LocationEntry }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const centre =
    location.lat !== undefined && location.lng !== undefined
      ? `${location.lat},${location.lng}`
      : location.address.trim() || location.name;

  if (!key) {
    return (
      <div className="flex h-[34mm] w-[46mm] shrink-0 items-center justify-center rounded border border-dashed border-neutral-300 p-2 text-center text-[7.5pt] leading-tight text-neutral-500">
        Add a Google Maps browser key to print a map here
      </div>
    );
  }

  const src =
    `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(centre)}` +
    `&zoom=15&size=368x272&scale=2&maptype=roadmap` +
    `&markers=color:red%7C${encodeURIComponent(centre)}&key=${key}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Map of ${location.name}`}
      className="h-[34mm] w-[46mm] shrink-0 rounded border border-neutral-300 object-cover"
    />
  );
}
