import type { CallSheetData, LocationEntry } from "../../../convex/lib/callSheetData";
import { sheetDays, sheetHotels } from "../../../convex/lib/callSheetData";
import { groupEquipmentBySupplier, callStrip, rowCallTime } from "./format";
import { EmailLink, PhoneLink } from "@/components/contact-link";
import { osmTiles } from "@/lib/maps";

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

/** "Mon 12 May", with the year when asked for. */
function formatShortDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // The year is added by hand: asked for one, en-GB also puts a comma after
  // the weekday ("Mon, 22 Jun 2026").
  const short = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return withYear ? `${short} ${y}` : short;
}

/** The dates a combined sheet covers, first to last. */
export function formatDateSpan(dates: string[]): string {
  const sorted = [...dates].sort();
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return formatDate(sorted[0]);
  return `${formatShortDate(sorted[0])} – ${formatShortDate(sorted[sorted.length - 1], true)}`;
}

/** Where a location is the same place, however it got onto the sheet. */
function placeKey(loc: LocationEntry): string {
  return loc.locationId ?? `${loc.name.trim().toLowerCase()}|${loc.address.trim().toLowerCase()}`;
}

/**
 * The single source of truth for call sheet layout. Rendered in the composer
 * preview and printed to PDF by headless Chromium. Keep colours print-safe
 * and avoid viewport-relative units.
 *
 * A sheet with `extraDays` is a combined sheet: the people, kit, hotels and
 * notes are printed once, and each date gets its own call, running order and
 * location underneath.
 */
export function CallSheetDocument({
  data,
  versionLabel,
}: {
  data: CallSheetData;
  versionLabel?: string;
}) {
  const days = sheetDays(data);
  const combined = days.length > 1;
  const hotels = sheetHotels(data);
  // Every place on the sheet once, in the order the dates reach them.
  const seen = new Set<string>();
  const locations = days
    .flatMap((day) => day.locations)
    .filter((loc) => {
      const key = placeKey(loc);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return (
    <div className="mx-auto w-[210mm] min-h-[297mm] bg-white px-[14mm] py-[16mm] font-sans text-[10pt] leading-snug text-neutral-900 print:min-h-0 print:w-auto print:bg-none! print:p-0"
      style={{
        // Where each A4 page ends. The document is 210mm wide with the same
        // margins the page box uses, so these rules fall where the PDF breaks.
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0 296.5mm, rgb(212 212 216) 296.5mm 297mm)",
      }}
    >
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
                className="mb-2 h-16 w-auto object-contain"
              />
            )}
            <p className="text-[8pt] uppercase tracking-widest text-neutral-500">
              {data.productionCompany}
              {data.clientName ? ` for ${data.clientName}` : ""}
            </p>
            <h1 className="mt-1 text-[20pt] font-bold leading-tight">{data.title}</h1>
            {/* Where it is, right under what it is. Anyone glancing at the top
                of a call sheet is looking for one of those two things. */}
            {locations[0] && (
              <p className="mt-0.5 text-[8.5pt] text-neutral-600">
                <span className="font-semibold">{locations[0].name}</span>
                {locations[0].address && (
                  <span> · {locations[0].address.replace(/\s*\n\s*/g, ", ")}</span>
                )}
                {locations.length > 1 && (
                  <span> · +{locations.length - 1} more below</span>
                )}
              </p>
            )}
            {/* The weather belongs to the place, so it is read with it. On a
                combined sheet it belongs to each date instead. */}
            {!combined && (data.weatherSummary || data.sunrise || data.sunset) && (
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-[8.5pt] text-neutral-600">
                {data.weatherSummary && <span>{data.weatherSummary}</span>}
                {data.sunrise && <span>Sunrise {data.sunrise}</span>}
                {data.sunset && <span>Sunset {data.sunset}</span>}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[14pt] font-bold">Call sheet</p>
            {combined && (
              <p className="text-[9pt] font-semibold">{days.length} shoot days</p>
            )}
            {versionLabel && <p className="text-[8pt] text-neutral-500">{versionLabel}</p>}
          </div>
        </div>
        {combined ? (
          <div className="mt-3 text-[11pt]">
            <p className="font-semibold">{formatDateSpan(days.map((day) => day.date))}</p>
            <p className="mt-0.5 text-[8.5pt] text-neutral-600">
              {days
                .map((day) => `${formatShortDate(day.date)} call ${callStrip(day)[0]?.time ?? day.generalCallTime}`)
                .join(" · ")}
            </p>
          </div>
        ) : (
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
        )}
      </header>

      {/* Important notices, before anything else on the sheet. */}
      {data.importantNotices && (
        <section className="mt-3 break-inside-avoid rounded border-2 border-neutral-900 px-3 py-2">
          <h2 className="text-[9pt] font-bold uppercase tracking-widest">Important</h2>
          <p className="mt-1 whitespace-pre-line font-medium">{data.importantNotices}</p>
        </section>
      )}

      {/* Crew, talent and client: one table, read together. */}
      {data.crew.length > 0 && (
        <PeopleSection
          title={data.crewSectionTitle ?? "Crew"}
          showCall={!combined}
          rows={data.crew.map((row) => ({ ...row, callTime: rowCallTime(data, row.callTime) }))}
        />
      )}

      {(data.contactSections ?? []).map((section) => (
        <PeopleSection
          key={section.id}
          title={section.title}
          showCall={!combined}
          rows={section.rows.map((row) => ({
            ...row,
            callTime: rowCallTime(data, row.callTime),
          }))}
        />
      ))}

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

      {/* Schedule */}
      {combined ? (
        days.map((day, i) => (
          <section key={day.id} className="mt-5 break-inside-avoid">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-neutral-400 pb-1">
              <h2 className="text-[9pt] font-bold uppercase tracking-widest">
                Day {i + 1} · {formatDate(day.date)}
                {day.label && (
                  <span className="ml-1 font-semibold normal-case tracking-normal text-neutral-600">
                    {day.label}
                  </span>
                )}
              </h2>
              <p className="flex flex-wrap justify-end gap-x-3 text-[9pt]">
                {callStrip(day).map((ct) => (
                  <span key={ct.id}>
                    <span className="font-semibold">{ct.label}: </span>
                    {ct.time}
                  </span>
                ))}
              </p>
            </div>
            {(day.locations.length > 0 || day.weatherSummary || day.sunrise || day.sunset) && (
              <p className="mt-1 flex flex-wrap gap-x-3 text-[8.5pt] text-neutral-600">
                {day.locations.length > 0 && (
                  <span>
                    <span className="font-semibold">
                      {day.locations.map((loc) => loc.name).join(", ")}
                    </span>
                  </span>
                )}
                {day.weatherSummary && <span>{day.weatherSummary}</span>}
                {day.sunrise && <span>Sunrise {day.sunrise}</span>}
                {day.sunset && <span>Sunset {day.sunset}</span>}
              </p>
            )}
            {day.schedule.length > 0 ? (
              <ScheduleTable schedule={day.schedule} />
            ) : (
              <p className="mt-2 text-[8.5pt] text-neutral-500">No running order yet.</p>
            )}
          </section>
        ))
      ) : (
        data.schedule.length > 0 && (
          <section className="mt-5 break-inside-avoid">
            <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
              Schedule
            </h2>
            <ScheduleTable schedule={data.schedule} />
          </section>
        )
      )}

      {/* Locations */}
      {locations.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            {locations.length === 1 ? "Location" : "Locations"}
          </h2>
          <div className="mt-2 space-y-3">
            {locations.map((loc, i) => (
              <div key={loc.id} className="flex gap-3 break-inside-avoid">
                {/* The map beside the getting-there and emergency detail, so
                    the two are read together rather than a page apart. */}
                <LocationMap location={loc} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {locations.length > 1 && <span className="mr-1">{i + 1}.</span>}
                    {loc.name}
                  </p>
                  <p className="whitespace-pre-line">{loc.address}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[8.5pt] text-neutral-600">
                    {loc.plusCode && (
                      <>
                        <dt className="font-semibold">Plus Code</dt>
                        <dd>{loc.plusCode}</dd>
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
                    {loc.accessNotes && (
                      <>
                        <dt className="font-semibold">Access</dt>
                        <dd className="whitespace-pre-line">{loc.accessNotes}</dd>
                      </>
                    )}
                    {loc.nearestTube && (
                      <>
                        <dt className="font-semibold">Nearest Tube</dt>
                        <dd>{loc.nearestTube}</dd>
                      </>
                    )}
                    {loc.nearestRail && (
                      <>
                        <dt className="font-semibold">Nearest rail</dt>
                        <dd>{loc.nearestRail}</dd>
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
                    {loc.notes && (
                      <>
                        <dt className="font-semibold">Notes</dt>
                        <dd className="whitespace-pre-line">{loc.notes}</dd>
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

      {hotels.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
            Accommodation
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
            {hotels.map((hotel) => (
              <div key={hotel.id} className="break-inside-avoid">
                <p className="font-semibold">{hotel.name}</p>
                {hotel.address && <p className="whitespace-pre-line">{hotel.address}</p>}
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[8.5pt] text-neutral-600">
                  {hotel.phone && (
                    <>
                      <dt className="font-semibold">Phone</dt>
                      <dd>
                        <PhoneLink phone={hotel.phone} fallback="" />
                      </dd>
                    </>
                  )}
                  {hotel.checkIn && (
                    <>
                      <dt className="font-semibold">Check-in</dt>
                      <dd>{hotel.checkIn}</dd>
                    </>
                  )}
                  {hotel.nights !== undefined && (
                    <>
                      <dt className="font-semibold">Nights</dt>
                      <dd>{hotel.nights}</dd>
                    </>
                  )}
                  {hotel.bookingRef && (
                    <>
                      <dt className="font-semibold">Booking ref</dt>
                      <dd>{hotel.bookingRef}</dd>
                    </>
                  )}
                  {hotel.notes && (
                    <>
                      <dt className="font-semibold">Notes</dt>
                      <dd className="whitespace-pre-line">{hotel.notes}</dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
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
 * without one the panel falls back to the Plus Code.
 *
 * That fallback is the point of carrying a Plus Code at all: nobody can click
 * a printed sheet, so a driver needs something short they can type into any
 * maps app. A grid reference does that; an apology for a missing key does not.
 */
function LocationMap({ location }: { location: LocationEntry }) {
  // Drawn from OpenStreetMap tiles rather than Google. The Embed API is an
  // iframe and will not print, and the Static Maps API bills per picture;
  // tiles are plain images, cost nothing, and print like any other.
  if (location.lat !== undefined && location.lng !== undefined) {
    return (
      <div className="w-[46mm] shrink-0">
        <MapImage lat={location.lat} lng={location.lng} />
        {location.plusCode && (
          <p className="mt-0.5 text-center font-mono text-[7.5pt] font-semibold text-neutral-800">
            {location.plusCode}
          </p>
        )}
      </div>
    );
  }
  // Never placed on a map, so there is nothing to centre on: the Plus Code if
  // there is one, since that is what a driver can type into any maps app.
  return (
    <div className="flex h-[34mm] w-[46mm] shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-neutral-300 p-2 text-center leading-tight">
      {location.plusCode ? (
        <>
          <span className="text-[7pt] tracking-wide text-neutral-500 uppercase">Plus Code</span>
          <span className="font-mono text-[9pt] font-semibold text-neutral-800">
            {location.plusCode}
          </span>
        </>
      ) : (
        <span className="text-[7.5pt] text-neutral-500">{location.address || location.name}</span>
      )}
    </div>
  );
}

/** The map box in CSS pixels: 46mm × 34mm at 96 per inch. */
const MAP_WIDTH = 174;
const MAP_HEIGHT = 128;
/** Street level: close enough to read the roads round the gate. */
const MAP_ZOOM = 15;

function MapImage({ lat, lng }: { lat: number; lng: number }) {
  // Laid out at twice the size one zoom level in, then halved, so the paper
  // gets twice the detail a screen-resolution tile would give it.
  const tiles = osmTiles(lat, lng, MAP_ZOOM + 1, MAP_WIDTH * 2, MAP_HEIGHT * 2);
  return (
    <div
      className="relative overflow-hidden rounded border border-neutral-300 bg-neutral-100"
      style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width: MAP_WIDTH * 2, height: MAP_HEIGHT * 2, transform: "scale(0.5)" }}
      >
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.url + tile.left}
            src={tile.url}
            alt=""
            width={256}
            height={256}
            className="absolute max-w-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}
      </div>
      {/* The pin's point, not its middle, is on the spot. */}
      <svg
        viewBox="0 0 24 32"
        width={16}
        height={21}
        className="absolute"
        style={{ left: MAP_WIDTH / 2 - 8, top: MAP_HEIGHT / 2 - 21 }}
        aria-hidden
      >
        <path
          d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 32 12 32s12-11.6 12-20.3C24 5.2 18.6 0 12 0z"
          fill="#dc2626"
          stroke="#fff"
          strokeWidth="1.5"
        />
        <circle cx="12" cy="11.5" r="4" fill="#fff" />
      </svg>
      {/* OpenStreetMap's licence asks for this wherever its map is shown. */}
      <span className="absolute right-0 bottom-0 bg-white/80 px-1 text-[5.5pt] leading-tight text-neutral-600">
        © OpenStreetMap
      </span>
    </div>
  );
}

/** A row of any of the three people lists, which carry the same fields. */
type PersonRow = {
  id: string;
  name: string;
  role: string;
  callTime?: string;
  phone?: string;
  email?: string;
  notes?: string;
};

/**
 * Crew, talent and client, laid out identically.
 *
 * They are read together — three lists of people to reach — so the columns
 * are the same, in the same order and at the same widths, and the eye does
 * not have to relearn the table three times down one page.
 */
function ScheduleTable({ schedule }: { schedule: CallSheetData["schedule"] }) {
  return (
    <table className="mt-2 w-full border-collapse">
      <tbody>
        {schedule.map((block) => (
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
  );
}

function PeopleSection({
  title,
  rows,
  showCall = true,
}: {
  title: string;
  rows: PersonRow[];
  /** Off on a combined sheet, where one call time would be right for one date only. */
  showCall?: boolean;
}) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="border-b border-neutral-400 pb-1 text-[9pt] font-bold uppercase tracking-widest">
        {title}
      </h2>
      {/* Fixed layout, not auto: three separate tables sized to their own
          content land their columns in three different places down the page.
          Only a fixed layout makes the widths mean the same thing in each. */}
      <table className="mt-2 w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-neutral-400 text-[8pt] uppercase tracking-wider text-neutral-500">
            <th className="w-[24%] py-1 pr-2 font-semibold">Role</th>
            <th className="w-[22%] py-1 pr-2 font-semibold">Name</th>
            <th className="w-[20%] py-1 pr-2 font-semibold">Phone</th>
            <th className="py-1 pr-2 font-semibold">Email</th>
            {showCall && <th className="w-14 py-1 font-semibold">Call</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-neutral-200 align-top">
              <td className="py-1.5 pr-2 break-words">{row.role}</td>
              <td className="py-1.5 pr-2 break-words">
                <span className="font-medium">{row.name}</span>
                {/* Kept off the columns so all three tables match, but not
                    thrown away: "brings own kit" is worth printing. */}
                {row.notes && (
                  <span className="block text-[8pt] text-neutral-600">{row.notes}</span>
                )}
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap">
                {/* Blank fallback: this also renders to PDF, where a
                    placeholder dot would be noise on the printed sheet. */}
                <PhoneLink phone={row.phone} fallback="" />
              </td>
              <td className="py-1.5 pr-2 break-words">
                {/* A fixed column clips rather than grows, and a truncated
                    address on a printed sheet is unusable — so it wraps. */}
                <EmailLink email={row.email} fallback="" className="whitespace-normal break-all" />
              </td>
              {showCall && <td className="py-1.5 font-semibold">{row.callTime ?? ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
