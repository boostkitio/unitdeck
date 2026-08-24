"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

/**
 * Google's embed API when a browser key is configured, otherwise the keyless
 * embed, which still renders a pin but without the richer place card.
 */
function mapEmbedSrc(query: string): string {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return key
    ? `https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(query)}`
    : `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

function mapLink(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function LocationSection({
  projectId,
  location,
}: {
  projectId: Id<"projects">;
  location: Doc<"locations"> | null;
}) {
  const [picking, setPicking] = useState(false);
  const updateProject = useMutation(api.projects.update);

  // Prefer coordinates when the location has been geocoded: a lat/lng drops the
  // pin exactly, where a free-text address can land on the wrong side of town.
  const query = useMemo(() => {
    if (!location) return null;
    if (location.lat !== undefined && location.lng !== undefined) {
      return `${location.lat},${location.lng}`;
    }
    return location.address.trim() || location.name;
  }, [location]);

  async function clearLocation() {
    try {
      await updateProject({ id: projectId, locationId: null });
      toast.success("Location removed from this project.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the location.");
    }
  }

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Location</CardTitle>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button size="sm" variant={location ? "ghost" : "default"} onClick={() => setPicking(true)}>
              {location ? "Change" : "Add location"}
            </Button>
            {location && (
              <Button size="sm" variant="ghost" onClick={() => void clearLocation()}>
                Remove
              </Button>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {location === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No location set. Add a new one or pick from your{" "}
            <Link href="/locations" className="underline underline-offset-2 text-foreground">
              saved locations
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2 text-sm">
              <p className="font-medium">{location.name}</p>
              <p className="text-muted-foreground">{location.address}</p>
              {location.w3w && (
                <p className="text-muted-foreground">
                  what3words: <span className="font-mono">{location.w3w}</span>
                </p>
              )}
              {location.parkingNotes && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Parking:</span>{" "}
                  {location.parkingNotes}
                </p>
              )}
              {location.accessNotes && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Access:</span>{" "}
                  {location.accessNotes}
                </p>
              )}
              {location.nearestHospital && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Nearest hospital:</span>{" "}
                  {location.nearestHospital}
                </p>
              )}
              {query && (
                <a
                  href={mapLink(query)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-primary underline underline-offset-2"
                >
                  Open in Google Maps
                </a>
              )}
            </div>

            {query && (
              <div className="overflow-hidden rounded-lg border border-border">
                <iframe
                  title={`Map of ${location.name}`}
                  src={mapEmbedSrc(query)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="aspect-video w-full"
                  allowFullScreen
                />
              </div>
            )}
          </div>
        )}
      </CardContent>

      {picking && (
        <LocationPickerDialog
          projectId={projectId}
          currentId={location?._id ?? null}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}

function LocationPickerDialog({
  projectId,
  currentId,
  onClose,
}: {
  projectId: Id<"projects">;
  currentId: Id<"locations"> | null;
  onClose: () => void;
}) {
  const locations = useQuery(api.locations.list, {});
  const updateProject = useMutation(api.projects.update);
  const createLocation = useMutation(api.locations.create);
  const geocode = useAction(api.locations.geocode);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [parkingNotes, setParkingNotes] = useState("");

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = locations ?? [];
    if (term.length === 0) return all;
    return all.filter(
      (l) =>
        l.name.toLowerCase().includes(term) || l.address.toLowerCase().includes(term),
    );
  }, [locations, search]);

  async function choose(locationId: Id<"locations">) {
    setSaving(true);
    try {
      await updateProject({ id: projectId, locationId });
      toast.success("Location set.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set the location.");
    } finally {
      setSaving(false);
    }
  }

  async function createAndChoose() {
    if (name.trim().length === 0) {
      toast.error("Give the location a name.");
      return;
    }
    if (address.trim().length === 0) {
      toast.error("Give the location an address.");
      return;
    }
    setSaving(true);
    try {
      const locationId = await createLocation({
        name,
        address,
        parkingNotes: parkingNotes.trim() || undefined,
      });
      await updateProject({ id: projectId, locationId });
      toast.success("Location added and set.");
      // Coordinates make the map pin exact; a failure here is not fatal, the
      // map falls back to the address.
      void geocode({ id: locationId }).catch(() => undefined);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project location</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border pb-3">
          <Button
            size="sm"
            variant={mode === "existing" ? "secondary" : "ghost"}
            onClick={() => setMode("existing")}
          >
            Select from previous
          </Button>
          <Button
            size="sm"
            variant={mode === "new" ? "secondary" : "ghost"}
            onClick={() => setMode("new")}
          >
            Add a new location
          </Button>
        </div>

        {mode === "existing" ? (
          <div className="space-y-3 py-2">
            <Input
              placeholder="Search saved locations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {locations === undefined ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : matches.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {(locations ?? []).length === 0
                  ? "No saved locations yet. Add a new one instead."
                  : "Nothing matches that search."}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {matches.map((l) => (
                  <li key={l._id}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void choose(l._id)}
                      className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {l.name}
                        {l._id === currentId && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            current
                          </span>
                        )}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{l.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-loc-name">Name</Label>
              <Input
                id="new-loc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Warehouse studio"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-loc-address">Address</Label>
              <Textarea
                id="new-loc-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 Example Street, London, SE1 1AA"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-loc-parking">Parking notes (optional)</Label>
              <Input
                id="new-loc-parking"
                value={parkingNotes}
                onChange={(e) => setParkingNotes(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saved to your locations list, so you can reuse it on other productions.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {mode === "new" && (
            <Button onClick={createAndChoose} disabled={saving}>
              {saving ? "Adding…" : "Add and set"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
