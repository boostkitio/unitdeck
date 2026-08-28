import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { TalentReleaseDocument } from "@/components/documents/talent-release-document";
import { PrintPageStyles } from "@/components/print-page-styles";

export const dynamic = "force-dynamic";

export default async function PrintDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const result = await client.query(api.documents.getForPrint, { token });
  if (!result) {
    return <p className="p-8 text-sm">This print link has expired.</p>;
  }
  return (
    <>
      <PrintPageStyles />
      <TalentReleaseDocument
        data={result.data}
        signature={result.signature ?? undefined}
      />
    </>
  );
}
