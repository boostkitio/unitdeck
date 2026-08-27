"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneLink } from "@/components/contact-link";

type Stay = Doc<"accommodation">;

/**
 * Where the unit sleeps.
 *
 * Sits under the location and reads like it, because it answers the same kind
 * of question — where is everyone, and how do I reach them there. A list
 * rather than one hotel: a job that moves books more than one, and "three
 * nights here then two there" is how the answer usually comes.
 */
export function AccommodationSection({ projectId }: { projectId: Id<"projects"> }) {
  const stays = useQuery(api.accommodation.listForProject, { projectId });
  const remove = useMutation(api.accommodation.remove);
  const [editing, setEditing] = useState<Stay | "new" | null>(null);
  const [confirming, setConfirming] = useState<Id<"accommodation"> | null>(null);

  async function handleRemove(stay: Stay) {
    if (confirming !== stay._id) {
      setConfirming(stay._id);
      return;
    }
    setConfirming(null);
    try {
      await remove({ id: stay._id });
      toast.success(`${stay.name} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove it.");
    }
  }

  const nights = (stays ?? []).reduce((sum, stay) => sum + (stay.nights ?? 0), 0);

  // mt-12, as every other section on this page carries: they are separate
  // cards rather than a stack, and should be spaced like the rest.
  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Accommodation</CardTitle>
        <CardAction>
          <Button size="sm" onClick={() => setEditing("new")}>
            Add hotel
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm">
        {stays === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : stays.length === 0 ? (
          <p className="text-muted-foreground">
            Nobody staying over. Add a hotel and its booking reference here when they are.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {stays.map((stay) => (
                <li key={stay._id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{stay.name}</p>
                    {stay.address && (
                      <p className="text-muted-foreground">{stay.address}</p>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {stay.nights !== undefined && (
                        <span>
                          {stay.nights} night{stay.nights === 1 ? "" : "s"}
                        </span>
                      )}
                      {stay.checkIn && <span>Check in {stay.checkIn}</span>}
                      {stay.bookingRef && (
                        <span>
                          Booking <span className="font-medium">{stay.bookingRef}</span>
                        </span>
                      )}
                      {stay.phone && <PhoneLink phone={stay.phone} />}
                    </p>
                    {stay.notes && <p className="mt-1 text-muted-foreground">{stay.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(stay)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemove(stay)}
                      onBlur={() => setConfirming(null)}
                      className={confirming === stay._id ? "text-destructive" : undefined}
                    >
                      {confirming === stay._id ? "Sure?" : "Remove"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            {nights > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {nights} night{nights === 1 ? "" : "s"} booked in total.
              </p>
            )}
          </>
        )}
      </CardContent>

      {editing !== null && (
        <StayDialog
          key={editing === "new" ? "new" : editing._id}
          projectId={projectId}
          stay={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function StayDialog({
  projectId,
  stay,
  onClose,
}: {
  projectId: Id<"projects">;
  stay: Stay | null;
  onClose: () => void;
}) {
  const add = useMutation(api.accommodation.add);
  const update = useMutation(api.accommodation.update);
  // The same place lookup the location dialog uses, so finding a hotel works
  // the way finding a location already does.
  const suggestAddress = useAction(api.locations.suggestAddress);
  const [lookup, setLookup] = useState("");
  const [suggestions, setSuggestions] = useState<
    { name: string; address: string }[] | null
  >(null);
  const [searching, setSearching] = useState(false);

  async function runLookup() {
    if (lookup.trim().length < 3) return;
    setSearching(true);
    try {
      const result = await suggestAddress({ query: lookup });
      setSuggestions(result.suggestions.map((s) => ({ name: s.name, address: s.address })));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not look that up.");
    } finally {
      setSearching(false);
    }
  }
  const [name, setName] = useState(stay?.name ?? "");
  const [address, setAddress] = useState(stay?.address ?? "");
  const [phone, setPhone] = useState(stay?.phone ?? "");
  const [checkIn, setCheckIn] = useState(stay?.checkIn ?? "");
  const [nights, setNights] = useState(stay?.nights !== undefined ? String(stay.nights) : "");
  const [bookingRef, setBookingRef] = useState(stay?.bookingRef ?? "");
  const [notes, setNotes] = useState(stay?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (name.trim().length === 0) {
      toast.error("Say which hotel.");
      return;
    }
    // Blank means "not said", which is different from zero nights.
    const parsed = nights.trim().length === 0 ? undefined : Number(nights);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
      toast.error("Nights should be a number.");
      return;
    }
    setSaving(true);
    try {
      const fields = { name, address, phone, checkIn, nights: parsed, bookingRef, notes };
      if (stay) await update({ id: stay._id, ...fields });
      else await add({ projectId, ...fields });
      toast.success("Saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{stay ? "Edit hotel" : "Add hotel"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="stay-lookup">Search for a hotel</Label>
            <div className="flex gap-2">
              <Input
                id="stay-lookup"
                placeholder="Hotel or place name…"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                onKeyDown={(e) => {
                  // Enter searches rather than submitting the dialog, which
                  // would save a half-filled hotel.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runLookup();
                  }
                }}
                disabled={searching}
                autoFocus
              />
              <Button
                type="button"
                variant="secondary"
                disabled={searching || lookup.trim().length < 3}
                onClick={() => void runLookup()}
              >
                {searching ? "Finding…" : "Find"}
              </Button>
            </div>
            {suggestions !== null && suggestions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No matches. Fill the fields in below instead.
              </p>
            )}
            {suggestions !== null && suggestions.length > 0 && (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                {suggestions.map((suggestion, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        setName(suggestion.name);
                        setAddress(suggestion.address);
                        setSuggestions(null);
                      }}
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="text-sm font-medium">{suggestion.name}</span>
                      <span className="text-xs text-muted-foreground">{suggestion.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="stay-name">Hotel</Label>
            <Input
              id="stay-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Where the unit is sleeping"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stay-address">Address</Label>
            <Input
              id="stay-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stay-nights">Nights</Label>
              <Input
                id="stay-nights"
                inputMode="numeric"
                value={nights}
                onChange={(e) => setNights(e.target.value)}
                placeholder="3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stay-checkin">Check in</Label>
              <Input
                id="stay-checkin"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                placeholder="Mon 12 May, from 3pm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stay-booking">Booking reference</Label>
              <Input
                id="stay-booking"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stay-phone">Phone</Label>
              <Input
                id="stay-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="stay-notes">Notes</Label>
            <Textarea
              id="stay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Parking, breakfast times, who is in which room"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
