"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import type { AddressSuggestion } from "../../../../convex/locations";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mapEmbedSrc, mapLink } from "@/lib/maps";
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
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/search-input";
import { CsvExportButton } from "@/components/csv-export-button";
import { matchesSearch } from "@/lib/search";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";

type LocationDoc = Doc<"locations">;

type LocationSortKey = "name" | "address" | "parking" | "coords";

function locationSortValue(l: LocationDoc, key: LocationSortKey): string | number | null {
  switch (key) {
    case "name":
      return l.name;
    case "address":
      return l.address;
    case "parking":
      return l.parkingNotes ?? null;
    case "coords":
      // Un-geocoded locations sort to the bottom rather than clustering at 0,0.
      return l.lat ?? null;
  }
}

export default function LocationsPage() {
  const { organization } = useOrganization();
  // Archiving already existed with no way back to what had been archived,
  // so a location put away by mistake was simply gone from the interface.
  const [showArchived, setShowArchived] = useState(false);
  const locations = useQuery(
    api.locations.list,
    organization ? (showArchived ? { archivedOnly: true } : {}) : "skip"
  );
  // Counted so the link can say how much is back there, as Projects does.
  const archived = useQuery(api.locations.list, organization ? { archivedOnly: true } : "skip");
  const [editing, setEditing] = useState<LocationDoc | "new" | null>(null);
  const [search, setSearch] = useState("");
  const { sort, toggle } = useTableSort<LocationSortKey>({ key: "name", dir: "asc" });

  const visible = useMemo(
    () =>
      sortRows(
        (locations ?? []).filter((l) =>
          matchesSearch(search, [
            l.name,
            l.address,
            l.plusCode,
            l.parkingNotes,
            l.accessNotes,
            l.nearestHospital,
            l.nearestPoliceStation,
            l.notes,
          ]),
        ),
        sort,
        locationSortValue,
      ),
    [locations, search, sort],
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {showArchived ? "Archived locations" : "Locations"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {showArchived
              ? "Kept for reference — everything recorded about them is still there."
              : "Every address you shoot at."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CsvExportButton
            filename="locations"
            headers={[
              "Name",
              "Address",
              "Nearest A&E",
              "Nearest police station",
              "Nearest station",
              "Plus Code",
              "Sat nav",
              "Notes",
            ]}
            rows={(locations ?? []).map((l) => [
              l.name,
              l.address,
              l.nearestHospital,
              l.nearestPoliceStation,
              l.nearestStation,
              l.plusCode,
              l.satNav,
              l.notes,
            ])}
          />
          <Button onClick={() => setEditing("new")}>Add location</Button>
        </div>
      </div>
      <div className="mt-6">
        {locations !== undefined && locations.length > 0 && (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search name, address, parking, access or notes…"
            className="mb-4 max-w-sm"
          />
        )}
        {locations === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : locations.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No locations yet. Add the studios, offices and venues you shoot at.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No locations match “{search}”.
          </p>
        ) : (
          <>
            {/* Below md a four-column table can only be read by dragging it
                sideways, so the phone gets name and address and the row opens
                the dialog that already holds everything else. */}
            <ul className="flex flex-col gap-2 md:hidden">
              {visible.map((l) => (
                <li key={l._id}>
                  <button
                    type="button"
                    onClick={() => setEditing(l)}
                    className="flex w-full flex-col gap-0.5 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="font-medium">{l.name}</span>
                    <span className="text-sm text-muted-foreground">{l.address}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                <SortableHead label="Address" sortKey="address" sort={sort} onSort={toggle} />
                <SortableHead label="Parking" sortKey="parking" sort={sort} onSort={toggle} />
                <SortableHead
                  label="Coordinates"
                  sortKey="coords"
                  sort={sort}
                  onSort={toggle}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((l) => (
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
            </div>
          </>
        )}

        {/* Same control, same words, same corner as the Projects list: the
            place to look for archived work should not move between tabs. */}
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived
              ? "← Back to active locations"
              : `View archived${archived !== undefined && archived.length > 0 ? ` (${archived.length})` : ""}`}
          </Button>
        </div>
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
  const enrichLocation = useAction(api.locations.enrichLocation);
  const suggestAddress = useAction(api.locations.suggestAddress);

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [plusCode, setPlusCode] = useState(location?.plusCode ?? "");
  const [parkingNotes, setParkingNotes] = useState(location?.parkingNotes ?? "");
  const [accessNotes, setAccessNotes] = useState(location?.accessNotes ?? "");
  const [nearestHospital, setNearestHospital] = useState(location?.nearestHospital ?? "");
  const [satNav, setSatNav] = useState(location?.satNav ?? "");
  const [nearestStation, setNearestStation] = useState(location?.nearestStation ?? "");
  const [nearestPoliceStation, setNearestPoliceStation] = useState(
    location?.nearestPoliceStation ?? ""
  );
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
    if (s.nearestPoliceStation) setNearestPoliceStation(s.nearestPoliceStation);
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
        plusCode: plusCode || undefined,
        parkingNotes: parkingNotes || undefined,
        accessNotes: accessNotes || undefined,
        nearestHospital: nearestHospital || undefined,
        satNav: satNav || undefined,
        nearestStation: nearestStation || undefined,
        nearestPoliceStation: nearestPoliceStation || undefined,
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
      // Fill everything derivable from the address — coordinates, nearest A&E
      // and police station, public transport and the Plus Code. Only blank fields
      // are written, so anything typed here survives.
      void enrichLocation({ id })
        .then((r) => {
          const filled = [
            r.nearestHospital && "nearest A&E",
            r.nearestPoliceStation && "police station",
            r.nearestStation && "nearest station",
            r.plusCode && "Plus Code",
          ].filter(Boolean);
          // Say so either way: a silent no-op looks identical to a failure.
          if (filled.length > 0) {
            toast.success(`Filled in ${filled.join(", ")}.`);
          } else {
            toast.info("Could not fill anything in from that address.");
          }
        })
        .catch(() => undefined);
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
  const embedSrc = address.trim() ? mapEmbedSrc(debouncedMapQuery) : null;
  const mapLinkHref = address.trim() ? mapLink(mapQuery) : null;

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
                    {s.nearestPoliceStation && (
                      <p className="text-xs text-muted-foreground">
                        Nearest police station: {s.nearestPoliceStation}
                      </p>
                    )}
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

          {/* Embedded Google Map — the tile itself opens Google Maps, so the
              frame is inert and the link sits over it. */}
          {mapLinkHref && (
            <div className="space-y-1">
              <div className="group relative">
                {embedSrc ? (
                  <iframe
                    title="Map"
                    src={embedSrc}
                    className="pointer-events-none h-48 w-full rounded-md border border-border"
                    loading="eager"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen={false}
                    tabIndex={-1}
                  />
                ) : (
                  /* No browser key: a link tile rather than an unsupported
                     embed. */
                  <div className="flex h-48 w-full items-center justify-center rounded-md border border-border bg-muted px-4 text-center text-sm text-muted-foreground">
                    Open this address in Google Maps
                  </div>
                )}
                {mapLinkHref && (
                  <a
                    href={mapLinkHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in Google Maps"
                    className="absolute inset-0 rounded-md transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  />
                )}
              </div>
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
              <Label htmlFor="loc-plus-code">Plus Code</Label>
              <Input
                id="loc-plus-code"
                placeholder="C2GX+2V Tunbridge Wells"
                value={plusCode}
                onChange={(e) => setPlusCode(e.target.value)}
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loc-satnav">Sat nav postcode</Label>
              <Input id="loc-satnav" value={satNav} onChange={(e) => setSatNav(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-police">Nearest police station</Label>
              <Input
                id="loc-police"
                value={nearestPoliceStation}
                onChange={(e) => setNearestPoliceStation(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="loc-station">Nearest station</Label>
            <Input
              id="loc-station"
              value={nearestStation}
              onChange={(e) => setNearestStation(e.target.value)}
              placeholder="White City (Central line), 6 min walk"
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
