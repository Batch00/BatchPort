"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LENGTH = 8;

export default function SetupPasswordPage() {
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Supabase sends the invite tokens in the URL hash fragment (not the query
  // string), which only exists in the browser. That is why this whole page must
  // be a client component: we read window.location.hash and exchange the tokens
  // for a session before showing the form.
  useEffect(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (!accessToken || !refreshToken) {
      setSessionError(
        "This link is invalid or has expired. Request a new invite at batch-apps.com.",
      );
      setReady(true);
      return;
    }

    const supabase = createClient();
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: setErr }) => {
        if (setErr) {
          setSessionError(
            "We could not verify your invite. Request a new one at batch-apps.com.",
          );
        }
        // Drop the tokens from the address bar once consumed.
        window.history.replaceState(null, "", window.location.pathname);
        setReady(true);
      });
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }

    window.location.assign("/dashboard");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0a0a0a] p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">
            Batch<span className="text-brand">Port</span>
          </CardTitle>
          <CardDescription>
            Choose a password to activate your BatchPort account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          ) : sessionError ? (
            <p className="text-sm text-destructive">{sessionError}</p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  disabled={submitting}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  disabled={submitting}
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <Button
                type="submit"
                disabled={submitting}
                className="bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {submitting ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  "Activate account"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
