export default function OfflinePage() {
  return (
    <main className="bg-background text-foreground min-h-screen flex flex-col items-center justify-center px-4">
      <h1 className="font-heading text-2xl font-semibold mb-3">You&apos;re offline</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        Reconnect to load the latest from UnitDeck.
      </p>
    </main>
  );
}
