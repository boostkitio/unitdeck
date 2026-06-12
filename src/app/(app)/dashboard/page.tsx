"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrganization } from "@clerk/nextjs";

const ACTIVE_STATUSES = ["brief", "pre_production", "shooting", "post"] as const;

export default function DashboardPage() {
  const { organization } = useOrganization();
  const projects = useQuery(api.projects.list, organization ? {} : "skip");
  const people = useQuery(api.people.list, organization ? {} : "skip");
  const clients = useQuery(api.clients.list, organization ? {} : "skip");
  const attention = useQuery(api.dashboard.attention, organization ? {} : "skip");

  if (!organization) {
    return (
      <div className="py-16 text-center text-neutral-500">
        <p className="text-lg font-medium">Create or select an organisation to get started.</p>
        <p className="mt-2 text-sm">Use the organisation switcher in the sidebar.</p>
      </div>
    );
  }

  const active = projects?.filter((p) => ACTIVE_STATUSES.includes(p.status as (typeof ACTIVE_STATUSES)[number]));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500">What needs attention across your productions.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Active projects" value={active?.length} href="/projects" />
        <StatCard label="People" value={people?.length} href="/people" />
        <StatCard label="Clients" value={clients?.length} href="/clients" />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Needs attention</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {attention === undefined || active === undefined ? (
            <Skeleton className="h-5 w-64" />
          ) : active.length === 0 ? (
            <p className="text-neutral-500">
              No active projects yet.{" "}
              <Link className="underline underline-offset-2" href="/projects">
                Create your first project
              </Link>{" "}
              to get going.
            </p>
          ) : attention.length === 0 ? (
            <p className="text-neutral-500">
              Nothing needs attention. Upcoming shoot days with unsent call sheets, unconfirmed
              crew or weather risk will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {attention.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.label}</p>
                    <p className="text-xs text-neutral-500">
                      {item.projectName} · {item.date}
                    </p>
                  </div>
                  <Link
                    className="shrink-0 text-xs underline underline-offset-2"
                    href={`/projects/${item.projectId}/shoot-days/${item.shootDayId}/call-sheet`}
                  >
                    Open call sheet
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, href }: { label: string; value: number | undefined; href: string }) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-neutral-500">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          {value === undefined ? (
            <Skeleton className="h-8 w-12" />
          ) : (
            <span className="text-3xl font-semibold tabular-nums">{value}</span>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
