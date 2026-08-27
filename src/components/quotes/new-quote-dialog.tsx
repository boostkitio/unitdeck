"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NOBODY = "nobody";

/**
 * Starting a quote.
 *
 * Neither the client nor a production is required. A quote is often what wins
 * the work, so the job does not exist yet and there may not even be a name for
 * it — and making somebody invent a production first would put a fake one in
 * the list every time a client asked what something would roughly cost.
 */
export function NewQuoteDialog({ onClose }: { onClose: () => void }) {
  const clients = useQuery(api.clients.list, {});
  const create = useMutation(api.quotes.create);
  const router = useRouter();

  const [clientId, setClientId] = useState<string>(NOBODY);
  const [title, setTitle] = useState("");
  const [quoteType, setQuoteType] = useState("Ballpark");
  const [saving, setSaving] = useState(false);

  async function start() {
    setSaving(true);
    try {
      const id = await create({
        clientId: clientId === NOBODY ? undefined : (clientId as Id<"clients">),
        title: title.trim() || undefined,
        quoteType,
      });
      router.push(`/quotes/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the quote.");
      setSaving(false);
    }
  }

  const clientName =
    clientId === NOBODY
      ? "Nobody yet"
      : ((clients ?? []).find((c) => c._id === clientId)?.name ?? "Nobody yet");

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="quote-title">What is it for</Label>
            <Input
              id="quote-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Docuseries, three episodes"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              What to call it until it becomes a production. You can put it on one later.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={(v) => v && setClientId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{clientName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOBODY}>Nobody yet</SelectItem>
                {(clients ?? []).map((client) => (
                  <SelectItem key={client._id} value={client._id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={quoteType} onValueChange={(v) => v && setQuoteType(v)}>
              <SelectTrigger className="w-40">
                <SelectValue>{quoteType}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Ballpark">Ballpark</SelectItem>
                <SelectItem value="Firm">Firm</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={saving}>
            {saving ? "Starting…" : "Start quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
