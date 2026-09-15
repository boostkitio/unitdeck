"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  isLocationRelease,
  type DocumentData,
  type LocationReleaseData,
  type TalentReleaseData,
} from "../../../convex/lib/documentData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TalentReleaseDocument } from "./talent-release-document";
import { SendReleaseButton, StatusBadge } from "./document-status";

type SaveState = "saved" | "saving" | "error";

export function ReleaseComposer({ id, onClose }: { id: Id<"documents">; onClose: () => void }) {
  const doc = useQuery(api.documents.get, { id });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(96vw,1080px)] max-w-none sm:max-w-none">
        {doc === undefined ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : doc === null ? (
          <p className="py-4 text-sm text-muted-foreground">This document could not be found.</p>
        ) : (
          <Composer doc={doc} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Composer({ doc, onClose }: { doc: Doc<"documents">; onClose: () => void }) {
  const saveDraft = useMutation(api.documents.saveDraft);
  const editable = doc.status === "draft";

  // Keyed by doc._id at the call site so this state resets if a different
  // document is opened without unmounting the dialog shell.
  const [data, setData] = useState<DocumentData>(doc.data);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback(
    (next: DocumentData) => {
      setData(next);
      if (!editable) return;
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await saveDraft({ id: doc._id, data: next });
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, 800);
    },
    [doc._id, editable, saveDraft]
  );

  // Never lose work: flush a pending save before the tab closes
  useEffect(() => {
    if (!editable) return;
    const handler = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveDraft({ id: doc._id, data });
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [data, doc._id, editable, saveDraft]);

  // Patched within one kind at a time: the fields on screen are the fields of
  // the document being edited, so a patch cannot cross from one to the other.
  function set(patch: Partial<DocumentData>) {
    onChange({ ...data, ...patch } as DocumentData);
  }

  const signature = doc.signature
    ? {
        typedName: doc.signature.typedName,
        drawnImage: doc.signature.drawnImage,
        signedAt: doc.signature.signedAt,
      }
    : undefined;

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
          <DialogTitle className="truncate">{doc.title}</DialogTitle>
          <div className="flex items-center gap-2">
            <StatusBadge status={doc.status} />
            {editable && <SendReleaseButton id={doc._id} label="Send for signing" variant="default" />}
          </div>
        </div>
      </DialogHeader>
      <p className="-mt-2 text-xs text-muted-foreground">
        {editable
          ? saveState === "saved"
            ? "Saved"
            : saveState === "saving"
              ? "Saving…"
              : "Save failed, retrying on next edit"
          : "Read-only. This release has been sent and can no longer be edited."}
      </p>

      <div className="grid gap-4 md:grid-cols-[360px_1fr]">
        <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
          <ComposerFields data={data} editable={editable} onChange={set} />
        </div>
        <div className="max-h-[58vh] overflow-y-auto rounded-md border border-border bg-muted p-4">
          <div className="origin-top scale-[0.55] shadow-xl">
            <TalentReleaseDocument data={data} signature={signature} />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}

function ComposerFields({
  data,
  editable,
  onChange,
}: {
  data: DocumentData;
  editable: boolean;
  onChange: (patch: Partial<DocumentData>) => void;
}) {
  return (
    <div className="space-y-6">
      {isLocationRelease(data) ? (
        <LocationFields
          data={data}
          editable={editable}
          onChange={onChange as (patch: Partial<LocationReleaseData>) => void}
        />
      ) : (
        <TalentFields
          data={data}
          editable={editable}
          onChange={onChange as (patch: Partial<TalentReleaseData>) => void}
        />
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Production details</h3>
        <div className="space-y-2">
          <Label htmlFor="rc-producer">Producer</Label>
          <Input
            id="rc-producer"
            disabled={!editable}
            value={data.producerName}
            onChange={(e) => onChange({ producerName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rc-company">Production company</Label>
          <Input
            id="rc-company"
            disabled={!editable}
            value={data.productionCompany}
            onChange={(e) => onChange({ productionCompany: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rc-title">Production title</Label>
          <Input
            id="rc-title"
            disabled={!editable}
            value={data.productionTitle}
            onChange={(e) => onChange({ productionTitle: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rc-law">Governing law</Label>
          <Input
            id="rc-law"
            disabled={!editable}
            value={data.governingLaw}
            onChange={(e) => onChange({ governingLaw: e.target.value })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Payment</h3>
        <div className="space-y-2">
          <Label htmlFor="rc-compensation">Compensation</Label>
          <Input
            id="rc-compensation"
            placeholder="e.g. £250 for the day, or Unpaid"
            disabled={!editable}
            value={data.compensation ?? ""}
            onChange={(e) => onChange({ compensation: e.target.value || undefined })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rc-terms">Additional terms</Label>
          <Textarea
            id="rc-terms"
            rows={4}
            disabled={!editable}
            value={data.additionalTerms ?? ""}
            onChange={(e) => onChange({ additionalTerms: e.target.value || undefined })}
          />
        </div>
      </section>
    </div>
  );
}

/** Who is being released, when the subject is a person. */
function TalentFields({
  data,
  editable,
  onChange,
}: {
  data: TalentReleaseData;
  editable: boolean;
  onChange: (patch: Partial<TalentReleaseData>) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Talent details</h3>
      <div className="space-y-2">
        <Label htmlFor="rc-talent-name">Name</Label>
        <Input
          id="rc-talent-name"
          disabled={!editable}
          value={data.talentName}
          onChange={(e) => onChange({ talentName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-talent-email">Email</Label>
        <Input
          id="rc-talent-email"
          type="email"
          disabled={!editable}
          value={data.talentEmail ?? ""}
          onChange={(e) => onChange({ talentEmail: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-talent-phone">Phone</Label>
        <Input
          id="rc-talent-phone"
          disabled={!editable}
          value={data.talentPhone ?? ""}
          onChange={(e) => onChange({ talentPhone: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-agent-name">Agent (optional)</Label>
        <Input
          id="rc-agent-name"
          disabled={!editable}
          value={data.agentName ?? ""}
          onChange={(e) => onChange({ agentName: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-agent-phone">Agent phone</Label>
        <Input
          id="rc-agent-phone"
          disabled={!editable}
          value={data.agentPhone ?? ""}
          onChange={(e) => onChange({ agentPhone: e.target.value || undefined })}
        />
      </div>
    </section>
  );
}

/**
 * Who is being released, when the subject is a place.
 *
 * The location and address come off the project; who owns it does not, so
 * that is the field asking to be filled — and it is the one that has to be
 * right, because it is who signs.
 */
function LocationFields({
  data,
  editable,
  onChange,
}: {
  data: LocationReleaseData;
  editable: boolean;
  onChange: (patch: Partial<LocationReleaseData>) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Location details</h3>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-name">Location</Label>
        <Input
          id="rc-loc-name"
          disabled={!editable}
          value={data.locationName}
          onChange={(e) => onChange({ locationName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-address">Address</Label>
        <Textarea
          id="rc-loc-address"
          rows={3}
          disabled={!editable}
          value={data.address}
          onChange={(e) => onChange({ address: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-owner">Owner or occupier</Label>
        <Input
          id="rc-loc-owner"
          disabled={!editable}
          placeholder="Who is signing for the location"
          value={data.ownerName}
          onChange={(e) => onChange({ ownerName: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-email">Email</Label>
        <Input
          id="rc-loc-email"
          type="email"
          disabled={!editable}
          value={data.ownerEmail ?? ""}
          onChange={(e) => onChange({ ownerEmail: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-phone">Phone</Label>
        <Input
          id="rc-loc-phone"
          disabled={!editable}
          value={data.ownerPhone ?? ""}
          onChange={(e) => onChange({ ownerPhone: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rc-loc-dates">Dates on the location</Label>
        <Input
          id="rc-loc-dates"
          disabled={!editable}
          value={data.shootDates ?? ""}
          onChange={(e) => onChange({ shootDates: e.target.value || undefined })}
        />
      </div>
    </section>
  );
}
