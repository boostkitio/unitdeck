"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The home page is served without Clerk middleware (so crawlers never meet
// the auth handshake), so the signed-in state is read in the browser. The
// server renders the signed-out version; a signed-in visitor sees the app
// link once Clerk has loaded.
function useSignedIn() {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && isSignedIn === true;
}

export function HeaderAuthLink() {
  if (useSignedIn()) {
    return (
      <Link
        href="/dashboard"
        className="text-sm font-medium text-neutral-300 transition-colors hover:text-white"
      >
        Open app
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <button
        data-track="sign_up_click"
        data-track-location="header"
        className="text-sm font-medium text-neutral-300 transition-colors hover:text-white"
      >
        Sign in
      </button>
    </SignInButton>
  );
}

export function HeroAuthAction() {
  if (useSignedIn()) {
    return (
      <Link
        href="/dashboard"
        className={cn(buttonVariants({ size: "lg" }), "bg-white text-neutral-950 hover:bg-neutral-200")}
      >
        Go to your dashboard
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <Button
        size="lg"
        data-track="sign_up_click"
        data-track-location="hero"
        className="bg-white text-neutral-950 hover:bg-neutral-200"
      >
        Get started
      </Button>
    </SignInButton>
  );
}
