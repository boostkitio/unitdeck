import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { CallSheetDocument } from "@/components/call-sheet/call-sheet-document";
import { PrintPageStyles } from "@/components/print-page-styles";

export const dynamic = "force-dynamic";

export default async function PrintToolPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const result = await client.query(api.tools.getRender, { token });
  if (!result) {
    return <p className="p-8 text-sm">This print link has expired.</p>;
  }
  return (
    <>
      <PrintPageStyles />
      <CallSheetDocument data={result.data} />
    </>
  );
}
