import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";

export default async function Home() {
  const { userId } = await auth();
  const signedIn = userId !== null;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-50">
      <header className="flex items-center justify-between px-8 py-6">
        <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
        <div className="flex items-center gap-3">
          {signedIn ? (
            <Button size="sm" render={<Link href="/dashboard">Open app</Link>} />
          ) : (
            <SignInButton mode="modal">
              <Button variant="secondary" size="sm">
                Sign in
              </Button>
            </SignInButton>
          )}
        </div>
      </header>
      <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {BRAND.tagline}
        </h1>
        <p className="mt-5 max-w-xl text-balance text-neutral-400">{BRAND.description}</p>
        <div className="mt-8 flex gap-3">
          {signedIn ? (
            <Button size="lg" render={<Link href="/dashboard">Go to your dashboard</Link>} />
          ) : (
            <SignInButton mode="modal">
              <Button size="lg">Get started</Button>
            </SignInButton>
          )}
        </div>
      </section>
      <footer className="px-8 py-6 text-sm text-neutral-500">
        {BRAND.name} · {BRAND.domain}
      </footer>
    </main>
  );
}
