import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Logo } from "@/components/logo";
import { WaitlistForm } from "./waitlist-form";
import { ShaderBand } from "./shader-band";

export function MarketingShell({
  children,
  source,
}: {
  children: React.ReactNode;
  source: string;
}) {
  return (
    <main className="min-h-screen bg-white text-neutral-900">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/">
          <Logo size={16} />
        </Link>
        <Link href="/" className="text-sm font-medium text-neutral-500 hover:text-neutral-900">
          Home
        </Link>
      </header>
      <article className="prose-headings:tracking-tight mx-auto max-w-3xl px-6 pb-16">
        {children}
      </article>
      <section className="relative overflow-hidden">
        <ShaderBand />
        <div className="relative mx-auto max-w-3xl px-6 py-14 text-white">
          <h2 className="text-xl font-semibold tracking-tight">
            Run your next shoot with {BRAND.name}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-neutral-200">
            From client brief to wrapped shoot day: AI call sheets, one-tap crew confirmations and
            a command centre for the whole company. Join the waitlist for early access.
          </p>
          <div className="mt-5">
            <WaitlistForm source={source} />
          </div>
        </div>
      </section>
      <footer className="mx-auto max-w-3xl px-6 py-6 text-sm text-neutral-400">
        {BRAND.name} · {BRAND.domain}
      </footer>
    </main>
  );
}
