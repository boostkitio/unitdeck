"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
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

  const [name, setName] = useState(location?.name ?? "");
  const [address, setAddress] = useState(location?.address ?? "");
  const [w3w, setW3w] = useState(location?.w3w ?? "");
  const [parkingNotes, setParkingNotes] = useState(location?.parkingNotes ?? "");
  const [accessNotes, setAccessNotes] = useState(location?.accessNotes ?? "");
  const [nearestHospital, setNearestHospital] = useState(location?.nearestHospital ?? "");
  const [busy, setBusy] = useState(false);

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
      // Geocode in the background; non-fatal if the address can't be resolved
      void geocode({ id }).then((r) => {
        if (r && !r.found) toast.info("Could not find coordinates for that address.");
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{location ? "Edit location" : "Add location"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
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
