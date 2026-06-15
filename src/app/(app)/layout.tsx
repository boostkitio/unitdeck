import { Toaster } from "@/components/ui/sonner";
import { OrgGate } from "./org-bootstrap";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>
        <OrgGate>{children}</OrgGate>
      </AppShell>
      <Toaster richColors />
    </>
  );
}
