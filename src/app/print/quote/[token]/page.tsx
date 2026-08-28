import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { QuoteDocument } from "@/components/quotes/quote-document";
import { PrintPageStyles } from "@/components/print-page-styles";

export const dynamic = "force-dynamic";

/**
 * The client's copy, addressed by a short-lived token so a headless browser
 * can read it without a login. Same component as the page inside the app, so
 * the PDF is the document that was on screen rather than a second rendering
 * of it that drifts.
 */
export default async function PrintQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const data = await client.query(api.quotes.getByRenderToken, { token });
  if (!data) {
    return <p className="p-8 text-sm">This print link has expired.</p>;
  }
  return (
    <>
      <PrintPageStyles />
      <QuoteDocument
        data={data}
        ownerName={data.quote.producerName ?? null}
        ownerEmail={data.quote.producerEmail ?? null}
      />
    </>
  );
}
