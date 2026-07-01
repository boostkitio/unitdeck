"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../../../../convex/_generated/dataModel";
import type { CallSheetData } from "../../../../../../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CallSheetDocument } from "@/components/call-sheet/call-sheet-document";
import { ComposerForm } from "@/components/call-sheet/composer-form";
import { SendDialog, RecipientStrip } from "@/components/call-sheet/send-dialog";
import { CheckDialog } from "@/components/agents/check-dialog";

export default function CallSheetPage({
  params,
}: {
  params: Promise<{ id: string; shootDayId: string }>;
}) {
  const { id, shootDayId } = use(params);
  const projectId = id as Id<"projects">;
  const dayId = shootDayId as Id<"shootDays">;
  const { organization } = useOrganization();
  const ensure = useMutation(api.callSheets.ensure);
  const draft = useQuery(api.callSheets.getCurrent, organization ? { shootDayId: dayId } : "skip");

  // First visit: create version 1 from shoot day defaults
  useEffect(() => {
    if (organization && draft === null) {
      void ensure({ shootDayId: dayId });
    }
  }, [organization, draft, ensure, dayId]);

  if (!organization || draft === undefined || draft === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Keyed by draft id: snapshot/restore create a new draft row and remount
  return <Composer key={draft._id} draft={draft} projectId={projectId} dayId={dayId} />;
}

type SaveState = "saved" | "saving" | "error";

function Composer({
  draft,
  projectId,
  dayId,
}: {
  draft: Doc<"callSheets">;
  projectId: Id<"projects">;
  dayId: Id<"shootDays">;
}) {
  const saveDraft = useMutation(api.callSheets.saveDraft);
  const snapshot = useMutation(api.callSheets.snapshotVersion);
  const refreshWeather = useAction(api.shootDays.refreshWeather);
  const orgDefaults = useQuery(api.organisations.callSheetDefaults, {});

  const [data, setData] = useState<CallSheetData>(draft.data);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      a.download = `${data.title.replace(/[^\w\- ]/g, "")} call sheet ${data.date} v${draft.version}.pdf`;
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
    <div className="-mx-8 -my-8 flex h-screen flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${projectId}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Back to project
          </Link>
          <h1 className="text-sm font-semibold">Call sheet · v{draft.version}</h1>
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
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const result = await refreshWeather({ id: dayId });
              if (result.ok) {
                // The action returns the snapshot directly; copy it into this document
                onChange({
                  ...data,
                  weatherSummary: result.weatherSummary,
                  sunrise: result.sunrise,
                  sunset: result.sunset,
                });
                toast.success("Weather updated.");
              } else {
                toast.info(result.reason);
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
            Refresh branding
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
              await snapshot({ shootDayId: dayId });
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
      <RecipientStrip dayId={dayId} />

      {/* Editor + live preview */}
      <div className="flex min-h-0 flex-1">
        <div className="w-full shrink-0 overflow-y-auto border-r border-border bg-card p-6 md:w-[420px]">
          <ComposerForm data={data} onChange={onChange} />
        </div>
        <div className="hidden flex-1 overflow-y-auto bg-muted p-8 md:block">
          <div className="origin-top scale-[0.85] shadow-xl">
            <CallSheetDocument data={data} versionLabel={`v${draft.version} draft`} />
          </div>
        </div>
      </div>

      {historyOpen && <HistoryDialog dayId={dayId} onClose={() => setHistoryOpen(false)} />}
      {sendOpen && <SendDialog dayId={dayId} data={data} onClose={() => setSendOpen(false)} />}
      {checkOpen && <CheckDialog dayId={dayId} onClose={() => setCheckOpen(false)} />}
    </div>
  );
}

function HistoryDialog({ dayId, onClose }: { dayId: Id<"shootDays">; onClose: () => void }) {
  const versions = useQuery(api.callSheets.listVersions, { shootDayId: dayId });
  const restore = useMutation(api.callSheets.restoreVersion);
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
                    await restore({ shootDayId: dayId, fromId: s._id });
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
