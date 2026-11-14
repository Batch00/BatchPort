"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateShareSettings } from "@/lib/actions/share-settings";
import { useConnectionGuard } from "@/lib/offline/use-offline";
import { cn } from "@/lib/utils";
import type { ShareSettings, ShareTripScope } from "@/lib/share-settings";

interface ShareSettingsFormProps {
  initial: ShareSettings;
  isDemo: boolean;
}

// The order and wording of the trip scope choices. The values are the ones the
// database's check constraint allows.
const SCOPE_OPTIONS: {
  value: ShareTripScope;
  label: string;
  description: string;
}[] = [
  {
    value: "past",
    label: "Past trips only",
    description: "Completed trips. Nothing upcoming or in progress.",
  },
  {
    value: "current",
    label: "Past and current",
    description: "Adds a trip while you are on it, including its remaining stops.",
  },
  {
    value: "all",
    label: "Everything",
    description: "Adds planned trips and their dates.",
  },
];

function Switch({
  checked,
  label,
  disabled,
  onToggle,
}: {
  checked: boolean;
  label: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-brand" : "bg-white/15",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
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
  const blockedOffline = useConnectionGuard();
  const [slug, setSlug] = useState(initial.public_slug ?? "");
  const [scope, setScope] = useState<ShareTripScope>(initial.share_trip_scope);
  const [shareJournal, setShareJournal] = useState(initial.share_journal);
  const [saving, setSaving] = useState(false);

  const shareUrl = slug ? `${shareBaseUrl()}/share/${slug}` : "";

  async function handleSave() {
    if (blockedOffline("Saving settings")) return;
    if (isDemo) {
      toast.error("Demo account settings are read-only.");
      return;
    }
    setSaving(true);
    const result = await updateShareSettings({
      publicShareEnabled: enabled,
      publicSlug: slug.trim() ? slug.trim() : null,
      shareTripScope: scope,
      shareJournal,
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
        <Switch
          checked={enabled}
          label="Toggle public sharing"
          disabled={isDemo}
          onToggle={() => setEnabled((value) => !value)}
        />
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label id="share-scope-label">Trips on your public profile</Label>
          <div
            role="radiogroup"
            aria-labelledby="share-scope-label"
            className="grid gap-2"
          >
            {SCOPE_OPTIONS.map((option) => {
              const selected = scope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isDemo}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl p-4 text-left ring-1 transition-colors disabled:opacity-50",
                    selected
                      ? "bg-brand/10 ring-brand/60"
                      : "bg-card ring-foreground/10 hover:bg-white/5",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-brand" : "border-foreground/30",
                    )}
                  >
                    {selected ? (
                      <span className="size-2 rounded-full bg-brand" />
                    ) : null}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-sm font-medium text-foreground">
            Share journal entries on shared trips
          </p>
          <Switch
            checked={shareJournal}
            label="Share journal entries on shared trips"
            disabled={isDemo}
            onToggle={() => setShareJournal((value) => !value)}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Notes on shared trips, stops and places are visible on your public
          profile.
        </p>
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
        // min-w-0 down the chain: without it the nowrap URL's intrinsic width
        // makes the grid and flex parents wider than the viewport on phones,
        // and the code block's truncate never engages.
        <div className="grid min-w-0 gap-2">
          <Label>Your shareable link</Label>
          <div className="flex min-w-0 items-center gap-2">
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
