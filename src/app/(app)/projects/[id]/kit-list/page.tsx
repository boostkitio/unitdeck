"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The kit list as a document rather than a spreadsheet.
 *
 * A CSV is a file somebody has to open, widen the columns of, and format
 * before it can be handed to a rental house or signed on collection. This is
 * the thing itself: the company's own heading, every line with the serial
 * number of the object it names, and a place to sign it.
 */
export default function KitListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useQuery(api.projectEquipment.kitList, {
    projectId: id as Id<"projects">,
  });

  if (data === undefined) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (data === null) {
    return <p className="p-6 text-sm text-muted-foreground">That production could not be found.</p>;
  }

  const sections = [
    { key: "equipment" as const, title: "Equipment" },
    { key: "additional" as const, title: "Additional / hired in" },
  ].map((section) => ({
    ...section,
    rows: data.items.filter((row) => row.section === section.key),
  }));

  const total = data.items.reduce((sum, row) => sum + (row.cost ?? 0), 0);

  return (
    <div>
      {/* Screen only: the page below is what prints. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" render={<Link href={`/projects/${id}`} />}>
          ← Back to the production
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="mx-auto max-w-4xl bg-white p-8 text-[10pt] text-neutral-900 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-neutral-900 pb-3">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Kit list</h1>
            <p className="mt-0.5 text-neutral-700">
              {data.project.name}
              {data.project.jobNumber && ` · ${data.project.jobNumber}`}
            </p>
          </div>
          {data.company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.company.logoUrl}
              alt={data.company.name}
              className="max-h-16 w-auto object-contain"
            />
          ) : (
            <p className="text-right font-heading text-lg font-semibold">{data.company.name}</p>
          )}
        </header>

        {data.items.length === 0 ? (
          <p className="py-12 text-center text-neutral-500">
            Nothing on this production’s kit list yet.
          </p>
        ) : (
          sections
            .filter((section) => section.rows.length > 0)
            .map((section) => (
              <section key={section.key} className="mt-6">
                <h2 className="text-[9pt] font-bold tracking-widest text-neutral-700 uppercase">
                  {section.title}
                </h2>
                <table className="mt-2 w-full table-fixed border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-400 text-left text-[8.5pt] uppercase tracking-wide text-neutral-600">
                      <th className="w-[16%] py-1 font-semibold">Dept</th>
                      <th className="w-[34%] py-1 font-semibold">Item</th>
                      <th className="w-[24%] py-1 font-semibold">Serial</th>
                      <th className="w-[8%] py-1 pr-4 text-right font-semibold">Qty</th>
                      <th className="w-[18%] py-1 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => (
                      <tr key={row.id} className="border-b border-neutral-200 align-top">
                        <td className="py-1.5 text-neutral-600">{row.dept ?? "—"}</td>
                        <td className="py-1.5 font-medium">{row.item}</td>
                        {/* Only ever the serial or the plain fact that there
                            is not one. Saying anything else here — what the
                            line is, where it came from — reads as a state the
                            serial is in. */}
                        <td className="py-1.5 font-mono text-[9pt] text-neutral-700">
                          {row.serialNumber ?? (
                            <span className="font-sans text-neutral-400">No serial number</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-4 text-right tabular-nums">{row.quantity}</td>
                        <td className="py-1.5 text-neutral-600">{row.notes ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[8.5pt] text-neutral-500">
                  {section.rows.length} line{section.rows.length === 1 ? "" : "s"}
                </p>
              </section>
            ))
        )}

        {total > 0 && (
          <p className="mt-4 text-right text-[9pt] text-neutral-700">
            Hire total: <span className="font-semibold">£{total.toLocaleString("en-GB")}</span>
          </p>
        )}

        {/* Signed on collection and again on return: the list is the record of
            what left and what came back. */}
        <footer className="mt-10 grid grid-cols-2 gap-8 border-t border-neutral-300 pt-6 text-[9pt]">
          {["Collected by", "Returned by"].map((label) => (
            <div key={label}>
              <p className="font-semibold text-neutral-700">{label}</p>
              <div className="mt-6 border-b border-neutral-400" />
              <p className="mt-1 text-neutral-500">Name and signature</p>
              <div className="mt-5 border-b border-neutral-400" />
              <p className="mt-1 text-neutral-500">Date</p>
            </div>
          ))}
        </footer>
      </article>
    </div>
  );
}
