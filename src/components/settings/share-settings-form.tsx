"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateShareSettings } from "@/lib/actions/share-settings";
import { cn } from "@/lib/utils";
import type { ShareSettings } from "@/lib/share-settings";

interface ShareSettingsFormProps {
  initial: ShareSettings;
  isDemo: boolean;
}

function shareBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function ShareSettingsForm({ initial, isDemo }: ShareSettingsFormProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.public_share_enabled);
  const [slug, setSlug] = useState(initial.public_slug ?? "");
  const [saving, setSaving] = useState(false);

  const shareUrl = slug ? `${shareBaseUrl()}/share/${slug}` : "";

  async function handleSave() {
    if (isDemo) {
      toast.error("Demo account settings are read-only.");
      return;
    }
    setSaving(true);
    const result = await updateShareSettings({
      publicShareEnabled: enabled,
      publicSlug: slug.trim() ? slug.trim() : null,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Settings saved.");
    router.refresh();
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {isDemo ? (
        <p className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-2 text-sm text-foreground/70">
          Demo account settings are read-only.
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div>
          <p className="text-sm font-medium text-foreground">
            Public sharing
          </p>
          <p className="text-xs text-muted-foreground">
            Anyone with your link can view a read-only version of your travel
            map and stats.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle public sharing"
          disabled={isDemo}
          onClick={() => setEnabled((value) => !value)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
            enabled ? "bg-brand" : "bg-white/15",
          )}
        >
          <span
            className={cn(
              "inline-block size-5 transform rounded-full bg-white transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="share-slug">Public slug</Label>
        <Input
          id="share-slug"
          value={slug}
          disabled={isDemo}
          placeholder="your-name"
          autoComplete="off"
          onChange={(event) =>
            setSlug(event.target.value.toLowerCase().replace(/\s+/g, "-"))
          }
        />
        <p className="text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens only.
        </p>
      </div>

      {shareUrl ? (
        <div className="grid gap-2">
          <Label>Your shareable link</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white/5 px-3 py-2 text-sm text-foreground/80">
              {shareUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Copy link"
              onClick={handleCopy}
            >
              <CopyIcon />
            </Button>
            <a
              href={`/share/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Preview share page"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLinkIcon className="size-4" />
            </a>
          </div>
          {!enabled ? (
            <p className="text-xs text-foreground/45">
              Sharing is currently off, so this link will not load for visitors.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={saving || isDemo}
          className="bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {saving ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </div>
  );
}
