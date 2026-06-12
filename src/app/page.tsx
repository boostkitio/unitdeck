import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { SignInButton } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

export default async function Home() {
  const { userId } = await auth();
  const signedIn = userId !== null;

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-50">
      {/* Background video. Decorative only: muted, looped, hidden from AT. */}
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/hero-poster.jpg"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      {/* Legibility overlays: flat darken plus a grounding gradient */}
      <div className="absolute inset-0 bg-neutral-950/70" aria-hidden="true" />
      <div
        className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-transparent to-neutral-950/60"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-8 py-6">
          <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
          {signedIn ? (
            <Link
              href="/dashboard"
              className="text-sm font-medium text-neutral-300 transition-colors hover:text-white"
            >
              Open app
            </Link>
          ) : (
            <SignInButton mode="modal">
              <button className="text-sm font-medium text-neutral-300 transition-colors hover:text-white">
                Sign in
              </button>
            </SignInButton>
          )}
        </header>
        <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {BRAND.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-balance text-neutral-300">{BRAND.description}</p>
          <div className="mt-8">
            {signedIn ? (
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "bg-white text-neutral-950 hover:bg-neutral-200"
                )}
              >
                Go to your dashboard
              </Link>
            ) : (
              <SignInButton mode="modal">
                <Button size="lg" className="bg-white text-neutral-950 hover:bg-neutral-200">
                  Get started
                </Button>
              </SignInButton>
            )}
          </div>
        </section>
        <footer className="flex flex-col gap-4 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-neutral-400">
            {BRAND.name} · {BRAND.domain}
          </span>
          <Link
            className="text-sm text-neutral-300 hover:text-white"
            href="/templates/call-sheet-template"
          >
            Free call sheet template
          </Link>
        </footer>
      </div>
    </main>
  );
}
