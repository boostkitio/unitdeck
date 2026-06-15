"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import type { BriefProposal } from "../../../convex/lib/agentProposals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BriefDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const parse = useAction(api.agents.briefParser.run);
  const approve = useMutation(api.agents.briefParser.approve);
  const reject = useMutation(api.agents.briefParser.reject);

  const [briefText, setBriefText] = useState("");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<Id<"agentRuns"> | null>(null);
  const [proposal, setProposal] = useState<BriefProposal | null>(null);

  async function runParse() {
    setBusy(true);
    try {
      const result = await parse({ briefText });
      setRunId(result.runId);
      setProposal(result.proposal);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse the brief.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (runId) {
      try {
        await reject({ runId });
      } catch {
        // already decided; nothing to do
      }
    }
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void discard()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{proposal ? "Review the proposal" : "New project from a brief"}</DialogTitle>
        </DialogHeader>

        {!proposal ? (
          <>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste the client&apos;s email thread, notes or brief. You review everything before
                anything is created.
              </p>
              <Textarea
                rows={10}
                placeholder="Hi Matt, we're after a 2-minute brand film…"
                value={briefText}
                onChange={(e) => setBriefText(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={busy || briefText.trim().length < 20} onClick={runParse}>
                {busy ? "Reading the brief…" : "Parse brief"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <ProposalReview
            proposal={proposal}
            busy={busy}
            onDiscard={discard}
            onApprove={async (final) => {
              setBusy(true);
              try {
                const projectId = await approve({ runId: runId!, ...final });
                toast.success("Project created from the brief.");
                onClose();
                router.push(`/projects/${projectId}`);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not create the project.");
                setBusy(false);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalReview({
  proposal,
  busy,
  onApprove,
  onDiscard,
}: {
  proposal: BriefProposal;
  busy: boolean;
  onApprove: (final: {
    projectName: string;
    clientName?: string;
    briefSummary?: string;
    shootDays: { date: string; label?: string }[];
  }) => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [projectName, setProjectName] = useState(proposal.projectName);
  const [clientName, setClientName] = useState(proposal.clientName ?? "");
  const [briefSummary, setBriefSummary] = useState(proposal.briefSummary ?? "");
  const [days, setDays] = useState(proposal.shootDays);

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="bp-name">Project name</Label>
          <Input
            id="bp-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bp-client">Client</Label>
          <Input
            id="bp-client"
            placeholder="Leave blank for no client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bp-summary">Brief summary</Label>
          <Textarea
            id="bp-summary"
            rows={3}
            value={briefSummary}
            onChange={(e) => setBriefSummary(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Shoot days</Label>
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dates found in the brief.</p>
          ) : (
            days.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="date"
                  className="w-40"
                  value={d.date}
                  onChange={(e) =>
                    setDays(days.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
                  }
                />
                <Input
                  placeholder="Label"
                  value={d.label ?? ""}
                  onChange={(e) =>
                    setDays(
                      days.map((x, j) =>
                        j === i ? { ...x, label: e.target.value || undefined } : x
                      )
                    )
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => setDays(days.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => void onDiscard()}>
          Discard
        </Button>
        <Button
          disabled={busy || projectName.trim() === ""}
          onClick={() =>
            void onApprove({
              projectName,
              clientName: clientName.trim() || undefined,
              briefSummary: briefSummary.trim() || undefined,
              shootDays: days,
            })
          }
        >
          {busy ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </>
  );
}
