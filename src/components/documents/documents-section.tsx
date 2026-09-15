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
import { FitToWidth } from "@/components/call-sheet/fit-to-width";
import { PagedPreview } from "./paged-preview";
import { ReleaseComposer } from "./release-composer";
import { StatusBadge, SendReleaseButton } from "./document-status";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function DocumentsSection({ projectId }: { projectId: Id<"projects"> }) {
  const docs = useQuery(api.documents.listForProject, { projectId });
  const [uploading, setUploading] = useState(false);
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
      toast.error(err instanceof Error ? err.message : "Could not download the PDF.");
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
            <Button size="sm" onClick={() => setUploading(true)}>
              Upload document
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
              No documents yet. Upload releases, risk assessments, creative or anything else
              this production needs.
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
                          ? doc.inviteDelivery?.status === "failed"
                            ? "Email failed to send"
                            : "Awaiting signature"
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
                    {/* Anything out and unsigned can be chased; a failed
                        delivery says so, since that is a retry not a nudge. */}
                    {doc.status === "sent" && (
                      <RetryInviteButton
                        id={doc._id}
                        failed={doc.inviteDelivery?.status === "failed"}
                      />
                    )}
                    {/* Downloadable at any stage: a release often goes to set
                        on paper, and waiting for a signature to be able to
                        print the thing being signed is the wrong way round. */}
                    <Button
                      size="sm"
                      variant={doc.status === "signed" ? "secondary" : "ghost"}
                      disabled={downloadingId === doc._id}
                      onClick={() => downloadSignedPdf(doc)}
                    >
                      {downloadingId === doc._id
                        ? "Downloading…"
                        : doc.status === "signed"
                          ? "Download signed PDF"
                          : "Download PDF"}
                    </Button>
                    <RemoveDocumentButton id={doc._id} title={doc.title} signed={doc.status === "signed"} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <UploadedFilesList projectId={projectId} />
        </CardContent>
      </Card>

      {uploading && (
        <UploadDocumentDialog projectId={projectId} onClose={() => setUploading(false)} />
      )}

      {composerId && <ReleaseComposer id={composerId} onClose={() => setComposerId(null)} />}

      {previewDoc && (
        <PreviewDialog doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </section>
  );
}

function RetryInviteButton({ id, failed }: { id: Id<"documents">; failed: boolean }) {
  const resend = useMutation(api.documents.resendInvite);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant={failed ? "secondary" : "ghost"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await resend({ id });
          toast.success(failed ? "Invite email queued again." : "Reminder sent.");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not send it again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Sending…" : failed ? "Retry email" : "Send reminder"}
    </Button>
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
          <FitToWidth>
            <PagedPreview>
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
            </PagedPreview>
          </FitToWidth>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Uploaded files ───────────────────────────────────────────────────────────

const DOCUMENT_KINDS = [
  { value: "talent_release", label: "Talent release" },
  { value: "location_release", label: "Location release" },
  { value: "risk_assessment", label: "Risk assessment" },
  { value: "creative", label: "Creative" },
  { value: "other", label: "Other" },
] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number]["value"];

function kindLabel(kind: string): string {
  return DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadedFilesList({ projectId }: { projectId: Id<"projects"> }) {
  const files = useQuery(api.projectFiles.listForProject, { projectId });
  const removeFile = useMutation(api.projectFiles.remove);

  async function handleRemove(id: Id<"projectFiles">, title: string) {
    try {
      await removeFile({ id });
      toast.success(`${title} deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete it.");
    }
  }

  if (files === undefined) {
    return <Skeleton className="mt-4 h-5 w-1/2" />;
  }
  if (files.length === 0) return null;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Uploaded files
      </p>
      <ul className="divide-y divide-border">
        {files.map((file) => {
          const size = formatBytes(file.size);
          return (
            <li key={file._id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{file.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {kindLabel(file.kind)} · {file.fileName}
                  {size ? ` · ${size}` : ""}
                </p>
                {file.notes && (
                  <p className="truncate text-xs text-muted-foreground">{file.notes}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {file.url && (
                  <Button variant="ghost" size="sm" render={<a href={file.url} target="_blank" rel="noreferrer" />}>
                    Open
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemove(file._id, file.title)}
                >
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Convex storage rejects larger uploads; fail early with a clear message.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function UploadDocumentDialog({
  projectId,
  onClose,
}: {
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const generateUploadUrl = useMutation(api.projectFiles.generateUploadUrl);
  const attach = useMutation(api.projectFiles.attach);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKind>("other");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleUpload() {
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That file is larger than 20 MB.");
      return;
    }
    setSaving(true);
    try {
      const uploadUrl = await generateUploadUrl({ projectId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

      await attach({
        projectId,
        fileId: storageId,
        title: title.trim() || file.name,
        kind,
        fileName: file.name,
        contentType: file.type || undefined,
        size: file.size,
        notes: notes.trim() || undefined,
      });
      toast.success("Document uploaded.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload that file.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="upload-file">File</Label>
            <input
              id="upload-file"
              type="file"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                // Default the title to the filename without its extension.
                if (chosen && title.trim().length === 0) {
                  setTitle(chosen.name.replace(/\.[^.]+$/, ""));
                }
              }}
            />
            <p className="text-xs text-muted-foreground">Up to 20 MB. Any file type.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-title">Title</Label>
            <Input
              id="upload-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Location release — Warehouse studio"
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={kind}
              onValueChange={(value) => {
                if (value !== null) setKind(value as DocumentKind);
              }}
            >
              <SelectTrigger className="w-64">
                <SelectValue>{kindLabel(kind)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-notes">Notes (optional)</Label>
            <Textarea
              id="upload-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={saving || !file}>
            {saving ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Take a release off the production.
 *
 * A signed one is a record, so that asks first; an unsigned draft raised on
 * the wrong person is just clutter and goes without ceremony.
 */
function RemoveDocumentButton({
  id,
  title,
  signed,
}: {
  id: Id<"documents">;
  title: string;
  signed: boolean;
}) {
  const remove = useMutation(api.documents.remove);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function go() {
    if (signed && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      await remove({ id });
      toast.success(`${title} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() => void go()}
      onBlur={() => setConfirming(false)}
    >
      {busy ? "Removing…" : confirming ? "Remove signed copy?" : "Remove"}
    </Button>
  );
}
