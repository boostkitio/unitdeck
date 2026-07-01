"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TalentReleaseDocument } from "./talent-release-document";
import { ReleaseComposer } from "./release-composer";
import { StatusBadge, SendReleaseButton } from "./document-status";

export function DocumentsSection({ projectId }: { projectId: Id<"projects"> }) {
  const docs = useQuery(api.documents.listForProject, { projectId });
  const [picking, setPicking] = useState(false);
  const [composerId, setComposerId] = useState<Id<"documents"> | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Doc<"documents"> | null>(null);
  const [downloadingId, setDownloadingId] = useState<Id<"documents"> | null>(null);

  async function downloadSignedPdf(doc: Doc<"documents">) {
    setDownloadingId(doc._id);
    try {
      const res = await fetch("/api/documents/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: doc.signToken }),
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/[^\w\- ]/g, "").trim() || "talent-release"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download the signed PDF.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="mt-12">
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardAction>
            <Button size="sm" onClick={() => setPicking(true)}>
              New talent release
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm">
          {docs === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : docs.length === 0 ? (
            <p className="text-muted-foreground">
              No documents yet. Start a talent release to collect a signed consent from someone on
              this project.
            </p>
          ) : (
            <ul className="divide-y divide-border -mx-1">
              {docs.map((doc) => (
                <li key={doc._id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{doc.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {doc.status === "declined"
                        ? doc.declineReason
                          ? `Declined: ${doc.declineReason}`
                          : "Declined"
                        : doc.status === "sent"
                          ? "Awaiting signature"
                          : doc.status === "signed" && doc.signature
                            ? `Signed ${new Date(doc.signature.signedAt).toLocaleDateString("en-GB")}`
                            : doc.status === "voided"
                              ? "Voided"
                              : "Not yet sent"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <StatusBadge status={doc.status} />
                    <Button size="sm" variant="ghost" onClick={() => setPreviewDoc(doc)}>
                      Preview
                    </Button>
                    {doc.status === "draft" && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setComposerId(doc._id)}>
                          Edit
                        </Button>
                        <SendReleaseButton id={doc._id} />
                      </>
                    )}
                    {doc.status === "signed" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={downloadingId === doc._id}
                        onClick={() => downloadSignedPdf(doc)}
                      >
                        {downloadingId === doc._id ? "Downloading…" : "Download signed PDF"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {picking && (
        <NewReleaseDialog
          projectId={projectId}
          onClose={() => setPicking(false)}
          onCreated={(id) => {
            setPicking(false);
            setComposerId(id);
          }}
        />
      )}

      {composerId && <ReleaseComposer id={composerId} onClose={() => setComposerId(null)} />}

      {previewDoc && (
        <PreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </section>
  );
}

function NewReleaseDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
  onCreated: (id: Id<"documents">) => void;
}) {
  const people = useQuery(api.people.list, {});
  const create = useMutation(api.documents.create);
  const [personId, setPersonId] = useState<Id<"people"> | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New talent release</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Talent</Label>
          <Select
            value={personId}
            onValueChange={(value) => setPersonId(value as Id<"people"> | null)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose from people…" />
            </SelectTrigger>
            <SelectContent>
              {(people ?? []).map((p) => (
                <SelectItem key={p._id} value={p._id}>
                  {p.name} ({p.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {people !== undefined && people.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No people yet. You can still create a blank release and fill in the talent&apos;s
              details by hand.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const id = await create({ projectId, personId: personId ?? undefined });
                toast.success("Talent release created.");
                onCreated(id);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not create the release.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ doc, onClose }: { doc: Doc<"documents">; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(96vw,900px)] max-w-none sm:max-w-none">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <DialogTitle className="truncate">{doc.title}</DialogTitle>
            <StatusBadge status={doc.status} />
          </div>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto rounded-md border border-border bg-muted p-6">
          <div className="origin-top scale-[0.7] shadow-xl">
            <TalentReleaseDocument
              data={doc.data}
              signature={
                doc.signature
                  ? {
                      typedName: doc.signature.typedName,
                      drawnImage: doc.signature.drawnImage,
                      signedAt: doc.signature.signedAt,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
