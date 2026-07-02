// Test-only environment and network stubs.
// SITE_URL / RESEND_API_KEY are read by scheduled email actions
// (convex/distribution.ts, convex/documents.ts, convex/agents/messageDrafter.ts);
// unset locally they throw and fail tests. The fetch stub keeps the suite
// hermetic: no real Resend calls, everything else passes through.
process.env.SITE_URL ??= "https://unitdeck.test";
process.env.RESEND_API_KEY ??= "resend-test-key";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/")) {
    return new Response(JSON.stringify({ id: "email_test_stub" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;
