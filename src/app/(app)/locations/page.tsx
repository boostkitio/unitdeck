"use client";

import { useState, useRef, useEffect } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { AddressSuggestion } from "../../../../convex/locations";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type LocationDoc = Doc<"locations">;

export default function LocationsPage() {
  const { organization } = useOrganization();
  const locations = useQuery(api.locations.list, organization ? {} : "skip");
  const [editing, setEditing] = useState<LocationDoc | "new" | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Locations</h1>
        <Button onClick={() => setEditing("new")}>Add location</Button>
      </div>
      <div className="mt-6">
        {locations === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : locations.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No locations yet. Add the studios, offices and venues you shoot at.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Parking</TableHead>
                <TableHead>Coordinates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((l) => (
                <TableRow key={l._id} className="cursor-pointer" onClick={() => setEditing(l)}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.address}</TableCell>
                  <TableCell>{l.parkingNotes ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.lat !== undefined
                      ? `${l.lat.toFixed(4)}, ${l.lng?.toFixed(4)}`
                      : "Not looked up"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {editing !== null && (
        <LocationDialog
          key={editing === "new" ? "new" : editing._id}
          location={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LocationDialog({
  location,
  onClose,
}: {
  location: LocationDoc | null;
  onClose: () => void;
}) {
  const createLocation = useMutation(api.locations.create);
  const updateLocation = useMutation(api.locations.update);
  const archiveLocation = useMutation(api.locations.archive);
  const geocode = useAction(api.locations.geocode);
  const suggestAddress = useAction(api.locations.suggestAddress);

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [w3w, setW3w] = useState(location?.w3w ?? "");
  const [parkingNotes, setParkingNotes] = useState(location?.parkingNotes ?? "");
  const [accessNotes, setAccessNotes] = useState(location?.accessNotes ?? "");
  const [nearestHospital, setNearestHospital] = useState(location?.nearestHospital ?? "");
  const [lat, setLat] = useState<number | undefined>(location?.lat);
  const [lng, setLng] = useState<number | undefined>(location?.lng);
  const [busy, setBusy] = useState(false);

  // Smart find state
  const [smartQuery, setSmartQuery] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[] | null>(null);
  const smartInputRef = useRef<HTMLInputElement>(null);

  async function runSmartFind() {
    if (smartQuery.trim().length < 3) return;
    setSmartBusy(true);
    setSuggestions(null);
    try {
      const result = await suggestAddress({ query: smartQuery });
      setSuggestions(result.suggestions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not fetch suggestions.");
    } finally {
      setSmartBusy(false);
    }
  }

  function applySuggestion(s: AddressSuggestion) {
    if (!name.trim() || name === location?.name) setName(s.name);
    setAddress(s.address);
    if (s.nearestHospital) setNearestHospital(s.nearestHospital);
    // The model's coordinates are only a rough estimate (often the town centre),
    // so discard them: the map geocodes the address via Google, and precise
    // lat/lng are resolved by the OpenStreetMap lookup on save.
    setLat(undefined);
    setLng(undefined);
    setSuggestions(null);
    setSmartQuery("");
  }

  async function save() {
    if (name.trim() === "" || address.trim() === "") {
      toast.error("Name and address are required.");
      return;
    }
    setBusy(true);
    try {
      const fields = {
        name,
        address,
        w3w: w3w || undefined,
        parkingNotes: parkingNotes || undefined,
        accessNotes: accessNotes || undefined,
        nearestHospital: nearestHospital || undefined,
        lat,
        lng,
      };
      let id: Id<"locations">;
      if (location) {
        await updateLocation({ id: location._id, ...fields });
        id = location._id;
      } else {
        id = await createLocation(fields);
      }
      toast.success("Location saved.");
      onClose();
      // Geocode in the background via OpenStreetMap to refine/fill coords;
      // only patches if it finds a result, so existing good coords survive
      void geocode({ id }).then((r) => {
        if (r && !r.found) toast.info("Could not find coordinates for that address.");
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  // Build the map src once. Prefer the address so Google geocodes it precisely
  // (the model's coordinates are only rough); fall back to lat/lng only when
  // there is no address yet.
  const mapQuery =
    address.trim() !== ""
      ? address.trim()
      : lat !== undefined && lng !== undefined
        ? `${lat},${lng}`
        : "";
  // Debounce so the map iframe doesn't reload on every keystroke while the
  // address is being edited.
  const [debouncedMapQuery, setDebouncedMapQuery] = useState(mapQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedMapQuery(mapQuery), 500);
    return () => clearTimeout(t);
  }, [mapQuery]);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapEmbedSrc = address.trim()
    ? mapsKey
      ? `https://www.google.com/maps/embed/v1/place?key=${mapsKey}&q=${encodeURIComponent(debouncedMapQuery)}`
      : `https://www.google.com/maps?q=${encodeURIComponent(debouncedMapQuery)}&output=embed`
    : null;
  const mapLinkHref = address.trim()
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`
    : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{location ? "Edit location" : "Add location"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Smart find row */}
          <div className="space-y-2">
            <Label htmlFor="loc-smart">Smart find</Label>
            <div className="flex gap-2">
              <Input
                id="loc-smart"
                ref={smartInputRef}
                placeholder="Search a venue, place or address…"
                value={smartQuery}
                onChange={(e) => setSmartQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runSmartFind();
                  }
                }}
                disabled={smartBusy}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={smartBusy || smartQuery.trim().length < 3}
                onClick={() => void runSmartFind()}
              >
                {smartBusy ? (
                  <span className="flex items-center gap-1.5">
                    <svg
                      className="h-3.5 w-3.5 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Finding…
                  </span>
                ) : (
                  "Find"
                )}
              </Button>
            </div>

            {/* Suggestion list */}
            {suggestions !== null && suggestions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No matches found. Enter the address manually below.
              </p>
            )}
            {suggestions !== null && suggestions.length > 0 && (
              <div className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    onClick={() => applySuggestion(s)}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1 text-muted-foreground">&mdash; {s.address}</span>
                    {s.nearestHospital && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Nearest A&amp;E: {s.nearestHospital}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="loc-name">Name</Label>
            <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-address">Address</Label>
            <Textarea
              id="loc-address"
              rows={2}
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                // Address edited manually: clear AI-supplied coords so the
                // map shows the typed address rather than stale coordinates
                setLat(undefined);
                setLng(undefined);
              }}
            />
          </div>

          {/* Embedded Google Map */}
          {mapEmbedSrc && (
            <div className="space-y-1">
              <iframe
                title="Map"
                src={mapEmbedSrc}
                className="h-48 w-full rounded-md border border-border"
                loading="eager"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen={false}
              />
              {mapLinkHref && (
                <a
                  href={mapLinkHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Open in Google Maps
                </a>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loc-w3w">what3words</Label>
              <Input
                id="loc-w3w"
                placeholder="///filled.count.soap"
                value={w3w}
                onChange={(e) => setW3w(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-hospital">Nearest A&amp;E</Label>
              <Input
                id="loc-hospital"
                value={nearestHospital}
                onChange={(e) => setNearestHospital(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-parking">Parking notes</Label>
            <Input
              id="loc-parking"
              value={parkingNotes}
              onChange={(e) => setParkingNotes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-access">Access notes</Label>
            <Input
              id="loc-access"
              value={accessNotes}
              onChange={(e) => setAccessNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {location ? (
            <Button
              variant="ghost"
              className="text-red-600"
              disabled={busy}
              onClick={async () => {
                await archiveLocation({ id: location._id });
                toast.success("Location archived.");
                onClose();
              }}
            >
              Archive
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
