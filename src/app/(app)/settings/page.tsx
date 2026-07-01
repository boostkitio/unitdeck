"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useOrganization } from "@clerk/nextjs";
import { toast } from "sonner";
import type { Infer } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { invoicingValidator } from "../../../../convex/lib/callSheetData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

type Invoicing = Infer<typeof invoicingValidator>;
type SettingsView = {
  name: string;
  brandColor?: string;
  invoicing?: Invoicing;
  confidentialByDefault?: boolean;
  logoUrl?: string;
};

export default function SettingsPage() {
  const { organization } = useOrganization();
  const settings = useQuery(api.organisations.settingsView, organization ? {} : "skip");

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Branding and invoicing defaults used on every new call sheet.
      </p>
      <div className="mt-6 max-w-2xl">
        {settings === undefined ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <SettingsForm settings={settings} />
        )}
      </div>
    </div>
  );
}

function SettingsForm({ settings }: { settings: SettingsView }) {
  const updateSettings = useMutation(api.organisations.updateSettings);
  const generateLogoUploadUrl = useMutation(api.organisations.generateLogoUploadUrl);
  const setLogo = useMutation(api.organisations.setLogo);

  const [brandColor, setBrandColor] = useState(settings.brandColor ?? "");
  const [legalName, setLegalName] = useState(settings.invoicing?.legalName ?? "");
  const [companyNumber, setCompanyNumber] = useState(settings.invoicing?.companyNumber ?? "");
  const [vatNumber, setVatNumber] = useState(settings.invoicing?.vatNumber ?? "");
  const [invoiceEmail, setInvoiceEmail] = useState(settings.invoicing?.invoiceEmail ?? "");
  const [receiptsNote, setReceiptsNote] = useState(settings.invoicing?.receiptsNote ?? "");
  const [confidentialByDefault, setConfidentialByDefault] = useState(
    settings.confidentialByDefault ?? false
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    try {
      const uploadUrl = await generateLogoUploadUrl({});
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
      await setLogo({ storageId });
      toast.success("Logo updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload logo.");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const hasInvoicing = [legalName, companyNumber, vatNumber, invoiceEmail, receiptsNote].some(
        (v) => v.trim() !== ""
      );
      await updateSettings({
        brandColor: brandColor || undefined,
        ...(hasInvoicing
          ? {
              invoicing: {
                legalName: legalName || undefined,
                companyNumber: companyNumber || undefined,
                vatNumber: vatNumber || undefined,
                invoiceEmail: invoiceEmail || undefined,
                receiptsNote: receiptsNote || undefined,
              },
            }
          : {}),
        confidentialByDefault,
      });
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Branding */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Branding</h2>
        <div className="space-y-2">
          <Label>Logo</Label>
          <div className="flex items-center gap-4">
            {settings.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.logoUrl}
                alt="Organisation logo"
                className="h-16 w-16 rounded-md border border-border bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                No logo
              </div>
            )}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoSelected}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading…" : settings.logoUrl ? "Replace logo" : "Upload logo"}
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-brand-colour">Brand colour</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick brand colour"
              className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
              value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#000000"}
              onChange={(e) => setBrandColor(e.target.value)}
            />
            <Input
              id="settings-brand-colour"
              placeholder="#1d4ed8"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="max-w-[160px]"
            />
          </div>
        </div>
      </section>

      {/* Invoicing */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Invoicing details</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="settings-legal-name">Legal name</Label>
            <Input
              id="settings-legal-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-company-number">Company number</Label>
            <Input
              id="settings-company-number"
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="settings-vat-number">VAT number</Label>
            <Input
              id="settings-vat-number"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-invoice-email">Invoice email</Label>
            <Input
              id="settings-invoice-email"
              type="email"
              value={invoiceEmail}
              onChange={(e) => setInvoiceEmail(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="settings-receipts-note">Receipts note</Label>
          <Textarea
            id="settings-receipts-note"
            rows={2}
            placeholder="e.g. Receipts required for all expenses over £25."
            value={receiptsNote}
            onChange={(e) => setReceiptsNote(e.target.value)}
          />
        </div>
      </section>

      {/* Defaults */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Defaults</h2>
        <label
          htmlFor="settings-confidential"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <input
            id="settings-confidential"
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={confidentialByDefault}
            onChange={(e) => setConfidentialByDefault(e.target.checked)}
          />
          Mark new call sheets as confidential by default
        </label>
      </section>

      <div className="flex justify-end">
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
