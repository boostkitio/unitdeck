"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { type AddressSuggestion } from "../../../convex/locations";
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
import { ReleaseComposer } from "@/components/documents/release-composer";
import { ReminderButton } from "@/components/projects/crew-section";
import { mapEmbedSrc, mapLink } from "@/lib/maps";

export function LocationSection({
  projectId,
  location,
}: {
  projectId: Id<"projects">;
  location: Doc<"locations"> | null;
}) {
  const [picking, setPicking] = useState(false);
  const [looking, setLooking] = useState(false);
  const [releaseId, setReleaseId] = useState<Id<"documents"> | null>(null);
  const [makingRelease, setMakingRelease] = useState(false);

  // Everything the address should have filled in on its own.
  const missing = location
    ? [
        !location.nearestHospital && "nearest A&E",
        !location.nearestPoliceStation && "police station",
        !location.nearestStation && "nearest station",
        !location.plusCode && "Plus Code",
      ].filter((v): v is string => typeof v === "string")
    : [];
  const updateProject = useMutation(api.projects.update);
  const enrichLocation = useAction(api.locations.enrichLocation);
  const ensureRelease = useMutation(api.documents.ensureForLocation);
  const releases = useQuery(api.documents.listForProject, { projectId });

  // The release raised for this location, whatever stage it has reached.
  const release = (releases ?? []).find(
    (doc) =>
      doc.type === "location_release" &&
      doc.status !== "voided" &&
      doc.data.kind === "location" &&
      doc.data.locationName === location?.name,
  );

  /**
   * Open the release for this location, raising it first if there is not one.
   * Everything but who owns the place is already known here.
   */
  async function openRelease() {
    if (!location) return;
    setMakingRelease(true);
    try {
      setReleaseId(await ensureRelease({ projectId, locationId: location._id }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the release.");
    } finally {
      setMakingRelease(false);
    }
  }

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
          {/* Release first, then the two that change what is here. */}
          <div className="flex items-center gap-1">
            {location && release?.status === "sent" ? (
              <ReminderButton id={release._id} />
            ) : location && release && release.status !== "draft" ? (
              <span
                title="See Documents below to preview or download it"
                className="px-2 text-xs text-muted-foreground"
              >
                Location release {release.status}
              </span>
            ) : location ? (
              <Button
                size="sm"
                variant="default"
                disabled={makingRelease}
                onClick={() => void openRelease()}
              >
                {makingRelease
                  ? "Opening…"
                  : release
                    ? "Edit location release form"
                    : "Location release form"}
              </Button>
            ) : null}
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
              {location.plusCode && (
                <p className="text-muted-foreground">
                  Plus Code: <span className="font-mono">{location.plusCode}</span>
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
                  <span className="font-medium text-foreground">Nearest A&amp;E:</span>{" "}
                  {location.nearestHospital}
                </p>
              )}
              {location.nearestPoliceStation && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Nearest police station:</span>{" "}
                  {location.nearestPoliceStation}
                </p>
              )}
              {location.nearestStation && (
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">Nearest station:</span>{" "}
                  {location.nearestStation}
                </p>
              )}
              {missing.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Not filled in yet: {missing.join(", ")}.
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={looking}
                    onClick={async () => {
                      setLooking(true);
                      try {
                        const result = await enrichLocation({ id: location._id });
                        const filled = [
                          result.nearestHospital && "nearest A&E",
                          result.nearestPoliceStation && "police station",
                          result.nearestStation && "nearest station",
                          result.plusCode && "Plus Code",
                        ].filter(Boolean);
                        if (filled.length > 0) {
                          toast.success(`Filled in ${filled.join(", ")}.`);
                        } else {
                          toast.info("Could not fill anything in from that address.");
                        }
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not look that up.",
                        );
                      } finally {
                        setLooking(false);
                      }
                    }}
                  >
                    {looking ? "Filling in…" : "Try again"}
                  </Button>
                </div>
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
              /* The whole map opens Google Maps. An iframe swallows clicks, so
                 the link sits over it and the frame itself is made inert —
                 the embed's own panning is worth less than the tile being the
                 obvious way through to directions. */
              <div className="group relative overflow-hidden rounded-lg border border-border">
                {mapEmbedSrc(query) ? (
                  <iframe
                    title={`Map of ${location.name}`}
                    src={mapEmbedSrc(query)!}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="pointer-events-none aspect-video w-full"
                    allowFullScreen
                    tabIndex={-1}
                  />
                ) : (
                  /* No browser key: a link tile rather than an unsupported
                     embed. The tile still goes to the same place. */
                  <div className="flex aspect-video w-full items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground">
                    Open this location in Google Maps
                  </div>
                )}
                <a
                  href={mapLink(query)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${location.name} in Google Maps`}
                  className="absolute inset-0 flex items-end justify-end p-2 transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="rounded-md bg-background/90 px-2 py-1 text-xs font-medium opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    Open in Google Maps
                  </span>
                </a>
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
    {releaseId && (
        <ReleaseComposer id={releaseId} onClose={() => setReleaseId(null)} />
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
  const enrichLocation = useAction(api.locations.enrichLocation);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [parkingNotes, setParkingNotes] = useState("");
  const [nearestHospital, setNearestHospital] = useState<string | undefined>();
  const [nearestPoliceStation, setNearestPoliceStation] = useState<string | undefined>();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Address lookup, the same one the locations page calls "Smart find".
  const suggestAddress = useAction(api.locations.suggestAddress);
  const [lookup, setLookup] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function runLookup() {
    if (lookup.trim().length < 3) return;
    setSearching(true);
    try {
      const result = await suggestAddress({ query: lookup });
      setSuggestions(result.suggestions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch suggestions.");
    } finally {
      setSearching(false);
    }
  }

  function applySuggestion(suggestion: AddressSuggestion) {
    setName(suggestion.name);
    setAddress(suggestion.address);
    setNearestHospital(suggestion.nearestHospital);
    setNearestPoliceStation(suggestion.nearestPoliceStation);
    setCoords(
      suggestion.lat !== undefined && suggestion.lng !== undefined
        ? { lat: suggestion.lat, lng: suggestion.lng }
        : null,
    );
    setSuggestions(null);
  }

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
        nearestHospital,
        nearestPoliceStation,
        lat: coords?.lat,
        lng: coords?.lng,
      });
      await updateProject({ id: projectId, locationId });
      toast.success("Location added and set.");
      // Coordinates make the map pin exact. The lookup usually supplies them;
      // geocode fills the gap when it did not. Failure is not fatal — the map
      // falls back to the address.
      // Fills coordinates, nearest A&E and police station, public transport
      // and the Plus Code. Only blank fields are touched, so a picked
      // suggestion's values survive.
      void enrichLocation({ id: locationId }).catch(() => undefined);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-full max-w-lg overflow-x-hidden overflow-y-auto">
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
                      className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
                    >
                      <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                        {l.name}
                        {l._id === currentId && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            current
                          </span>
                        )}
                      </span>
                      <span className="block w-full truncate text-xs text-muted-foreground">{l.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-loc-lookup">Search for a place</Label>
              <div className="flex gap-2">
                <Input
                  id="new-loc-lookup"
                  placeholder="Venue, place or address…"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  onKeyDown={(e) => {
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
                        onClick={() => applySuggestion(suggestion)}
                        className="flex w-full min-w-0 flex-col gap-0.5 overflow-hidden px-3 py-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span className="truncate text-sm font-medium">{suggestion.name}</span>
                        <span className="block w-full truncate text-xs text-muted-foreground">
                          {suggestion.address}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">
                Picking a result fills the fields below. You can edit them, or skip the search
                and type a custom location yourself.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-loc-name">Name</Label>
              <Input
                id="new-loc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Warehouse studio"
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
