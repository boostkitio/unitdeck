"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import type { CallSheetData } from "../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CallSheetDocument } from "@/components/call-sheet/call-sheet-document";
import { FitToWidth } from "@/components/call-sheet/fit-to-width";
import { PagedPreview } from "@/components/documents/paged-preview";
import { ComposerForm } from "@/components/call-sheet/composer-form";
import { SendDialog, RecipientStrip } from "@/components/call-sheet/send-dialog";
import { CheckDialog } from "@/components/agents/check-dialog";

/**
 * Which call sheet the composer is working on: one shoot day's own, or the
 * production's combined sheet covering several dates.
 */
export type SheetTarget =
  | { kind: "day"; dayId: Id<"shootDays"> }
  | { kind: "combined"; projectId: Id<"projects"> };

type SaveState = "saved" | "saving" | "error";

export function CallSheetComposer({
  draft,
  target,
  backHref,
}: {
  draft: Doc<"callSheets">;
  target: SheetTarget;
  /** Where "Back to project" goes: the project page, by the reference in the URL. */
  backHref: string;
}) {
  const saveDraft = useMutation(api.callSheets.saveDraft);
  const snapshotDay = useMutation(api.callSheets.snapshotVersion);
  const snapshotCombined = useMutation(api.callSheets.snapshotCombined);
  const refreshWeather = useAction(api.shootDays.refreshWeatherForProject);
  const orgDefaults = useQuery(api.organisations.callSheetDefaults, {});

  const [data, setData] = useState<CallSheetData>(draft.data);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extraDates = data.extraDays?.length ?? 0;

  const onChange = useCallback(
    (next: CallSheetData) => {
      setData(next);
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await saveDraft({ id: draft._id, data: next });
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, 800);
    },
    [draft._id, saveDraft]
  );

  // Editing a location updates this draft on the server. Take its locations
  // when that happens, so the next autosave does not put the old ones back.
  const serverLocations = JSON.stringify([
    draft.data.locations,
    draft.data.extraDays?.map((day) => day.locations),
  ]);
  const seenLocations = useRef(serverLocations);
  useEffect(() => {
    if (seenLocations.current === serverLocations) return;
    seenLocations.current = serverLocations;
    setData((prev) => ({
      ...prev,
      locations: draft.data.locations,
      extraDays: prev.extraDays?.map((day) => {
        const fresh = draft.data.extraDays?.find((d) => d.id === day.id);
        return fresh ? { ...day, locations: fresh.locations } : day;
      }),
    }));
    // draft.data is read through serverLocations, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverLocations]);

  // Never lose work: flush a pending save before the tab closes
  useEffect(() => {
    const handler = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveDraft({ id: draft._id, data });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [data, draft._id, saveDraft]);

  async function exportPdf() {
    setExporting(true);
    try {
      const res = await fetch("/api/call-sheets/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callSheetId: draft._id }),
      });
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const lastDate = data.extraDays?.at(-1)?.date;
      const dates = lastDate ? `${data.date} to ${lastDate}` : data.date;
      a.download = `${data.title.replace(/[^\w\- ]/g, "")} call sheet ${dates} v${draft.version}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF exported.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    /* The negative margins cancel the shell padding, so they have to track it:
       px-4/py-6 on mobile, px-8/py-8 from md up. Getting this wrong pushed the
       page past the viewport edge and dragged it sideways. */
    <div className="-mx-4 -my-6 flex flex-col md:-mx-8 md:-my-8 md:h-screen">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Back to project
          </Link>
          <h1 className="text-sm font-semibold">
            {extraDates > 0 ? `Combined call sheet · ${extraDates + 1} dates` : "Call sheet"} · v
            {draft.version}
          </h1>
          <span
            className={
              saveState === "error"
                ? "text-xs font-medium text-red-600"
                : "text-xs text-muted-foreground"
            }
          >
            {saveState === "saved"
              ? "Saved"
              : saveState === "saving"
                ? "Saving…"
                : "Save failed — retrying on next edit"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                // Every date on the production, so a combined sheet gets each
                // of its days' weather and not just the first.
                const { days } = await refreshWeather({ projectId: draft.projectId, force: true });
                const byDay = new Map(days.map((day) => [day.shootDayId, day]));
                const first = byDay.get(draft.shootDayId);
                onChange({
                  ...data,
                  weatherSummary: first?.weatherSummary ?? data.weatherSummary,
                  sunrise: first?.sunrise ?? data.sunrise,
                  sunset: first?.sunset ?? data.sunset,
                  extraDays: data.extraDays?.map((extra) => {
                    const found = extra.shootDayId ? byDay.get(extra.shootDayId) : undefined;
                    return found
                      ? {
                          ...extra,
                          weatherSummary: found.weatherSummary ?? extra.weatherSummary,
                          sunrise: found.sunrise ?? extra.sunrise,
                          sunset: found.sunset ?? extra.sunset,
                        }
                      : extra;
                  }),
                });
                const missing = [first, ...(data.extraDays ?? []).map((extra) =>
                  extra.shootDayId ? byDay.get(extra.shootDayId) : undefined,
                )].filter((day) => day && !day.weatherSummary);
                if (missing.length > 0 && missing[0]?.reason) toast.info(missing[0].reason);
                else toast.success("Weather updated.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not update the weather.");
              }
            }}
          >
            Refresh weather
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!orgDefaults}
            onClick={() => {
              if (!orgDefaults) return;
              onChange({
                ...data,
                branding: orgDefaults.branding ?? data.branding,
                invoicing: orgDefaults.invoicing ?? data.invoicing,
                confidential: orgDefaults.confidential ?? data.confidential,
              });
              toast.success("Refreshed from organisation defaults.");
            }}
          >
            Refresh from organisation defaults
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCheckOpen(true)}>
            Check sheet
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              if (target.kind === "day") await snapshotDay({ shootDayId: target.dayId });
              else await snapshotCombined({ projectId: target.projectId });
              toast.success(`Version ${draft.version} saved to history.`);
            }}
          >
            Save version
          </Button>
          <Button size="sm" variant="secondary" disabled={exporting} onClick={exportPdf}>
            {exporting ? "Exporting…" : "Export PDF"}
          </Button>
          <Button size="sm" onClick={() => setSendOpen(true)}>
            Send
          </Button>
        </div>
      </div>
      <RecipientStrip target={target} />

      {/* Editor + live preview */}
      <div className="flex min-h-0 flex-1">
        {/* The settings are what you are actually working in, so they get the
            room; the sheet is a check that it reads right, so it sits tighter. */}
        <div className="w-full shrink-0 border-r border-border bg-card p-4 md:w-[480px] md:overflow-y-auto md:p-6 lg:w-[560px]">
          <ComposerForm data={data} onChange={onChange} projectId={draft.projectId} />
        </div>
        <div className="hidden min-w-0 flex-1 overflow-y-auto bg-muted p-6 md:block">
          <FitToWidth>
            <PagedPreview>
              <CallSheetDocument data={data} versionLabel={`v${draft.version} draft`} />
            </PagedPreview>
          </FitToWidth>
        </div>
      </div>

      {historyOpen && <HistoryDialog target={target} onClose={() => setHistoryOpen(false)} />}
      {sendOpen && <SendDialog target={target} data={data} onClose={() => setSendOpen(false)} />}
      {checkOpen && (
        <CheckDialog
          dayId={draft.shootDayId}
          combinedProjectId={target.kind === "combined" ? target.projectId : undefined}
          onClose={() => setCheckOpen(false)}
        />
      )}
    </div>
  );
}

function HistoryDialog({ target, onClose }: { target: SheetTarget; onClose: () => void }) {
  const dayVersions = useQuery(
    api.callSheets.listVersions,
    target.kind === "day" ? { shootDayId: target.dayId } : "skip",
  );
  const combinedVersions = useQuery(
    api.callSheets.listCombinedVersions,
    target.kind === "combined" ? { projectId: target.projectId } : "skip",
  );
  const versions = target.kind === "day" ? dayVersions : combinedVersions;
  const restoreDay = useMutation(api.callSheets.restoreVersion);
  const restoreCombined = useMutation(api.callSheets.restoreCombined);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {(versions ?? []).map((s) => (
            <li key={s._id} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium">
                  v{s.version}
                  {s.status === "draft" ? " (current draft)" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(s._creationTime).toLocaleString("en-GB")}
                  {s.versionNote ? ` · ${s.versionNote}` : ""}
                </p>
              </div>
              {s.status !== "draft" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    if (target.kind === "day") {
                      await restoreDay({ shootDayId: target.dayId, fromId: s._id });
                    } else {
                      await restoreCombined({ projectId: target.projectId, fromId: s._id });
                    }
                    toast.success(`Restored v${s.version} into a new draft.`);
                    onClose();
                  }}
                >
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
