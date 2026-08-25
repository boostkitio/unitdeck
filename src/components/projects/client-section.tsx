"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableHead, sortRows, useTableSort } from "@/components/sortable-head";
import { EmailLink, PhoneLink } from "@/components/contact-link";

type ContactRow = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
};

type ContactSortKey = "name" | "role" | "email" | "phone";

function contactSortValue(contact: ContactRow, key: ContactSortKey): string | number | null {
  switch (key) {
    case "name":
      return contact.name;
    case "role":
      return contact.role ?? null;
    case "email":
      return contact.email ?? null;
    case "phone":
      return contact.phone ?? null;
  }
}

/**
 * The client's people, laid out exactly like crew and talent.
 *
 * The three boxes are read together — they are the three lists a call sheet
 * needs — so they share a table, the same columns in the same order, the same
 * widths and the same buttons. A client contact has no booking status, so that
 * column sits empty rather than shifting everything after it out of line.
 */
export function ProjectClientSection({
  clientId,
  clientName,
}: {
  clientId: Id<"clients"> | null;
  clientName: string | null;
}) {
  const client = useQuery(api.clients.get, clientId ? { id: clientId } : "skip");
  const { sort, toggle } = useTableSort<ContactSortKey>({ key: "name", dir: "asc" });
  const contacts = useMemo(
    () => sortRows((client?.contacts ?? []) as ContactRow[], sort, contactSortValue),
    [client, sort],
  );

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Client</CardTitle>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" render={<Link href="/clients" />}>
              All clients
            </Button>
            <Button size="sm" render={<Link href="/clients" />}>
              {clientId ? "Edit contacts" : "Choose a client"}
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!clientId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No client on this production. Choose one under Details above.
          </p>
        ) : client === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : client === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {clientName ?? "That client"} is no longer in your clients list.
          </p>
        ) : contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No contacts for {client.name} yet. Add them on your{" "}
            <Link href="/clients" className="underline underline-offset-2 text-foreground">
              clients
            </Link>{" "}
            list.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium">{client.name}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Name" sortKey="name" sort={sort} onSort={toggle} />
                  <SortableHead label="Role" sortKey="role" sort={sort} onSort={toggle} />
                  {/* Kept so the columns line up with crew and talent. */}
                  <TableHead className="w-32" />
                  <SortableHead label="Email" sortKey="email" sort={sort} onSort={toggle} />
                  <SortableHead label="Phone" sortKey="phone" sort={sort} onSort={toggle} />
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((contact, i) => (
                  <TableRow key={`${contact.name}-${i}`}>
                    <TableCell className="font-medium">{contact.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.role ?? "·"}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-muted-foreground">
                      <EmailLink email={contact.email} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <PhoneLink phone={contact.phone} />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
