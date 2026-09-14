import type { CallSheetData } from "./callSheetData";

export const FROM = "UnitDeck <callsheets@mail.unitdeck.app>";

/**
 * The From line, in the name of whoever pressed send.
 *
 * The address itself cannot be theirs: mail is signed for mail.unitdeck.app,
 * and sending as somebody@klaxon.studio from a domain Klaxon has not
 * authorised is what a spam filter is for — it lands in junk or is rejected
 * outright. So the name is theirs, the address is ours, and Reply-To is
 * theirs, which is what makes a reply go where they expect. To a client it
 * reads as being from the producer, and answering it reaches the producer.
 *
 * If a customer wants their own domain on the envelope, that is a DNS record
 * away — verify the domain with the mail provider and this becomes their
 * address for real.
 */
export function fromLine(name: string | undefined): string {
  const cleaned = name?.trim().replace(/["<>]/g, "");
  if (!cleaned) return FROM;
  return `${cleaned} (UnitDeck) <callsheets@mail.unitdeck.app>`;
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** A file to go out with the email. `content` is base64, as Resend wants it. */
export type EmailAttachment = { filename: string; content: string };

/** One Resend call. Never throws: callers decide what a failure means. */
export async function sendEmail(args: {
  apiKey: string;
  to: string[];
  subject: string;
  html: string;
  from?: string;
  /** Where a reply goes: the person who sent it, not the app. */
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: args.from ?? FROM,
        to: args.to,
        subject: args.subject,
        html: args.html,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
        ...(args.attachments?.length ? { attachments: args.attachments } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 500)}` };
    }
    const json = (await res.json()) as { id: string };
    return { ok: true, id: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown send error" };
  }
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatEmailDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function callSheetEmail(args: {
  data: CallSheetData;
  recipientName: string;
  recipientCallTime: string;
  setModeUrl: string;
  isUpdate: boolean;
}): { subject: string; html: string } {
  const { data, recipientName, recipientCallTime, setModeUrl, isUpdate } = args;
  // A combined sheet names its first and last date, so nobody reads it as a
  // one-day call.
  const lastDate = data.extraDays?.at(-1)?.date;
  const dateText = lastDate
    ? `${formatEmailDate(data.date)} to ${formatEmailDate(lastDate)}`
    : formatEmailDate(data.date);
  const subject = `${isUpdate ? "Updated call sheet" : "Call sheet"}: ${data.title} – ${dateText}`;
  const firstLocation = data.locations[0];

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#737373;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#171717;">${value}</td></tr>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#737373;">${escapeHtml(data.productionCompany)}</p>
  <h1 style="margin:6px 0 2px;font-size:22px;color:#171717;">${escapeHtml(data.title)}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#404040;">${isUpdate ? "Your call sheet has been updated. Please check the latest details below." : "Your call sheet is ready."}</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;margin-bottom:24px;">
    ${row("Hello", escapeHtml(recipientName))}
    ${row("Date", escapeHtml(dateText))}
    ${row("Your call time", `<strong>${escapeHtml(recipientCallTime)}</strong>`)}
    ${row(lastDate ? "Day 1 general call" : "General call", escapeHtml(data.generalCallTime))}
    ${firstLocation ? row("Location", `${escapeHtml(firstLocation.name)}<br/><span style="color:#525252;">${escapeHtml(firstLocation.address)}</span>`) : ""}
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#171717;">
    <a href="${setModeUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Open your call sheet</a>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:13px;color:#737373;">Please confirm your availability on the page above. The link is personal to you, no login needed.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html };
}

export function talentReleaseInviteEmail(args: {
  talentName: string;
  productionTitle: string;
  productionCompany: string;
  signUrl: string;
  /** A location release is the same email about a different thing. */
  kind?: "talent" | "location";
  /** Sent again to somebody who already has it, so it says so. */
  reminder?: boolean;
}): { subject: string; html: string } {
  const location = args.kind === "location";
  const label = location ? "Location release" : "Talent release";
  const subject = args.reminder
    ? `Reminder: please sign your ${label.toLowerCase()} — ${args.productionTitle}`
    : `Please sign your ${label.toLowerCase()}: ${args.productionTitle}`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#737373;">${escapeHtml(args.productionCompany)}</p>
  <h1 style="margin:6px 0 8px;font-size:22px;color:#171717;">${escapeHtml(label)}</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#404040;">${args.reminder ? "A gentle reminder — this is still waiting for you." : ""} Hello ${escapeHtml(args.talentName)}, please review and sign your ${escapeHtml(label.toLowerCase())} for ${escapeHtml(args.productionTitle)}.</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#171717;">
    <a href="${args.signUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Review and sign</a>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:13px;color:#737373;">The link is personal to you, no login needed.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}

export function signedCopyEmail(args: {
  talentName: string;
  productionTitle: string;
  productionCompany: string;
  viewUrl: string;
}): { subject: string; html: string } {
  const subject = `Signed: talent release - ${args.productionTitle}`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
  <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#737373;">${escapeHtml(args.productionCompany)}</p>
  <h1 style="margin:6px 0 8px;font-size:22px;color:#171717;">Talent release signed</h1>
  <p style="margin:0 0 20px;font-size:14px;color:#404040;">Hello ${escapeHtml(args.talentName)}, your talent release for ${escapeHtml(args.productionTitle)} has been signed. You can view or download it here.</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#171717;">
    <a href="${args.viewUrl}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View signed release</a>
  </td></tr></table>
  <p style="margin:16px 0 0;font-size:13px;color:#737373;">The link is personal to you, no login needed.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html };
}

/**
 * The note a quote goes out with.
 *
 * Deliberately short: the quote is the attachment, and a client who asked
 * what something costs wants the figure, not three paragraphs of preamble.
 * Whatever the producer typed goes above the line; nothing is put in their
 * mouth beyond it.
 */
export function quoteEmail(args: {
  orgName: string;
  fromName?: string;
  message?: string;
  number?: string;
  title?: string;
}): string {
  const heading = [args.number, args.title].filter(Boolean).join(" — ");
  const body = args.message?.trim();
  return `
    <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #111;">
      <p style="margin: 0 0 12px;">Hello,</p>
      ${
        body
          ? `<p style="margin: 0 0 12px; white-space: pre-wrap;">${escapeHtml(body)}</p>`
          : `<p style="margin: 0 0 12px;">Our quote is attached${heading ? ` (${escapeHtml(heading)})` : ""}.</p>`
      }
      <p style="margin: 0 0 12px;">The PDF is attached to this email. Any questions, just reply.</p>
      <p style="margin: 0;">${escapeHtml(args.fromName ?? args.orgName)}<br />
        <span style="color: #555;">${escapeHtml(args.orgName)}</span>
      </p>
    </div>
  `;
}
