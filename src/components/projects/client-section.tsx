"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailLink, PhoneLink } from "@/components/contact-link";

/**
 * The client's people, in their own box.
 *
 * Crew, talent and client are the three lists a call sheet needs, and they are
 * kept apart here for the same reason they are kept apart there. The details
 * live on the client record rather than being copied onto the production, so
 * changing a phone number once changes it everywhere.
 */
export function ProjectClientSection({
  clientId,
  clientName,
}: {
  clientId: Id<"clients"> | null;
  clientName: string | null;
}) {
  const client = useQuery(api.clients.get, clientId ? { id: clientId } : "skip");

  return (
    <Card className="mt-12">
      <CardHeader>
        <CardTitle>Client</CardTitle>
        {clientId && (
          <CardAction>
            <Link
              href="/clients"
              className="text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground"
            >
              Edit contacts
            </Link>
          </CardAction>
        )}
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
        ) : (
          <div className="space-y-3">
            <p className="font-medium">{client.name}</p>
            {client.contacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No contacts yet.{" "}
                <Link href="/clients" className="underline underline-offset-2">
                  Add one
                </Link>{" "}
                and they will show here.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {client.contacts.map((contact, i) => (
                  <li
                    key={`${contact.name}-${i}`}
                    className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium">{contact.name}</span>
                      {contact.role && (
                        <span className="ml-2 text-xs text-muted-foreground">{contact.role}</span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <PhoneLink phone={contact.phone} fallback="" />
                      <EmailLink email={contact.email} fallback="" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
