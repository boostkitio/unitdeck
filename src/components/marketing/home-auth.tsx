"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The home page is static so search engines get it without a redirect. Whether
// the visitor is signed in is therefore worked out in the browser: the page is
// served in its signed-out form and switches once Clerk has loaded.

export function HomeHeaderLink() {
  const { isSignedIn } = useAuth();
  const className = "text-sm font-medium text-neutral-300 transition-colors hover:text-white";
  if (isSignedIn) {
    return (
      <Link href="/dashboard" className={className}>
        Open app
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <button className={className}>Sign in</button>
    </SignInButton>
  );
}

export function HomeCta() {
  const { isSignedIn } = useAuth();
  if (isSignedIn) {
    return (
      <Link
        href="/dashboard"
        className={cn(
          buttonVariants({ size: "lg" }),
          "bg-white text-neutral-950 hover:bg-neutral-200"
        )}
      >
        Go to your dashboard
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <Button size="lg" className="bg-white text-neutral-950 hover:bg-neutral-200">
        Get started
      </Button>
    </SignInButton>
  );
}
