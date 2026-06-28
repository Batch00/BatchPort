"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2Icon } from "lucide-react";

import { createClient } from "@/utils/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Interactive landing actions overlaid on the globe. Sign-in happens in-place
// (a compact Card), never on a separate page, so the globe stays visible and
// interactive behind the form. The demo is a sessionless read-only page, so the
// demo button is a plain link to /demo (no credentials, no sign-in).
export function LandingActions() {
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSignInError(null);
    setSigningIn(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setSignInError(error.message);
      setSigningIn(false);
      return;
    }
    // Full navigation so the server picks up the freshly set auth cookies.
    window.location.assign("/dashboard");
  }

  return (
    <div className="pointer-events-auto flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          size="lg"
          onClick={() => setShowSignIn((open) => !open)}
          aria-expanded={showSignIn}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          Sign in
        </Button>
        <Link
          href="/demo"
          className={cn(
            buttonVariants({ size: "lg", variant: "outline" }),
            "border-white/15 bg-white/5 backdrop-blur-sm hover:bg-white/10",
          )}
        >
          Try a Demo
        </Link>
      </div>

      {showSignIn ? (
        <Card className="w-full bg-card/80 backdrop-blur-md">
          <CardContent>
            <form onSubmit={handleSignIn} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={signingIn}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="signin-password">Password</Label>
                <Input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={signingIn}
                />
              </div>
              {signInError ? (
                <p className="text-sm text-destructive">{signInError}</p>
              ) : null}
              <Button
                type="submit"
                disabled={signingIn}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {signingIn ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-sm text-foreground/60">
        BatchPort is invite-only. Request access at{" "}
        <a
          href="https://www.batch-apps.com"
          className="text-brand underline-offset-4 hover:underline"
        >
          batch-apps.com
        </a>
        .
      </p>
    </div>
  );
}
