"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  CloudOffIcon,
  Loader2Icon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { discardEntry, retryFailed, syncQueue } from "@/lib/offline/queue";
import { describeOp, describeOpContext } from "@/lib/offline/queue-types";
import {
  useOfflineQueue,
  useOnlineStatus,
  useReplayOnReconnect,
} from "@/lib/offline/use-offline";
import { isStale, loadSnapshot, refreshSnapshot } from "@/lib/offline/snapshot";
import { cn } from "@/lib/utils";

// The offline indicator: one small chip in the nav, and the queue behind it.
//
// The brief was "calm, not alarming", and the shape follows from that. It is a
// chip, not a banner: it never pushes the page down, never covers content, and
// never appears at all when there is nothing to say. Being offline is a normal
// state for this app (that is the entire premise of the feature), so it reads
// as a status, not an error. Amber, not red, and no icon that suggests
// something broke.
//
// It says three different things depending on what is true, in priority order:
//
//   1. Something failed to send. That is the only state that earns attention,
//      because it is the only one that needs a decision from the user.
//   2. Writes are waiting. Offline or mid-replay; either way the count is the
//      message, since "did my checkoff save" is the actual question.
//   3. Just offline, nothing pending. A quiet "Offline" and an explanation of
//      what still works.
//
// Online with an empty queue renders nothing. An indicator that is always
// there is an indicator nobody reads.

export function OfflineStatus({ className }: { className?: string }) {
  const online = useOnlineStatus();
  const { entries, syncing } = useOfflineQueue();
  const [open, setOpen] = useState(false);

  useReplayOnReconnect();

  // Keep the offline snapshot current: once on mount and on every reconnect.
  // Fire and forget, because no render waits on it.
  useEffect(() => {
    const refresh = async () => {
      if (!navigator.onLine) return;
      const stored = await loadSnapshot();
      if (isStale(stored)) void refreshSnapshot();
    };
    void refresh();
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const failed = entries.filter((entry) => entry.failedReason !== null);
  const pending = entries.filter((entry) => entry.failedReason === null);

  if (online && entries.length === 0) return null;

  const tone = failed.length > 0 ? "warn" : "muted";
  const label =
    failed.length > 0
      ? `${failed.length} not sent`
      : pending.length > 0
        ? `${pending.length} waiting`
        : "Offline";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          failed.length > 0
            ? `${failed.length} changes could not be sent`
            : pending.length > 0
              ? `${pending.length} changes waiting to send`
              : "You are offline"
        }
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors",
          tone === "warn"
            ? "bg-amber-400/10 text-amber-300/90 hover:bg-amber-400/15"
            : "bg-white/5 text-foreground/60 hover:bg-white/10 hover:text-foreground/80",
          className,
        )}
      >
        {failed.length > 0 ? (
          <TriangleAlertIcon className="size-3.5 shrink-0" />
        ) : syncing ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
        ) : online ? (
          <CloudOffIcon className="size-3.5 shrink-0" />
        ) : (
          <WifiOffIcon className="size-3.5 shrink-0" />
        )}
        <span className="whitespace-nowrap">{label}</span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-white/10 px-3 py-2.5">
          <p className="text-sm font-medium text-foreground/85">
            {online ? "Connected" : "You are offline"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-foreground/50">
            {online
              ? "Waiting changes are sending now."
              : "Your trips, plans and journal are readable from the last copy saved on this device. Checkoffs, journal entries, new experiences and bucket completions are queued and sent when you are back."}
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="px-3 py-3 text-xs text-foreground/45">
            Nothing is waiting to be sent.
          </div>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {entries.map((entry) => {
              const context = describeOpContext(entry.op);
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 px-3 py-2 text-xs"
                >
                  <span className="mt-0.5 shrink-0 text-foreground/35">
                    {entry.failedReason ? (
                      <TriangleAlertIcon className="size-3.5 text-amber-300/80" />
                    ) : (
                      <CheckIcon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-foreground/80">
                      {describeOp(entry.op)}
                    </span>
                    {context ? (
                      <span className="block break-words text-foreground/40">
                        {context}
                      </span>
                    ) : null}
                    {entry.failedReason ? (
                      <span className="mt-0.5 block break-words text-amber-300/70">
                        {entry.failedReason}
                      </span>
                    ) : null}
                  </span>
                  {entry.failedReason ? (
                    <button
                      type="button"
                      onClick={() => void discardEntry(entry.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-foreground/45 transition-colors hover:bg-white/5 hover:text-foreground/80"
                    >
                      Discard
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
          <span className="text-[11px] text-foreground/35">
            Newest wins if the same thing changed elsewhere.
          </span>
          {online && entries.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                void (failed.length > 0 ? retryFailed() : syncQueue());
              }}
              disabled={syncing}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-foreground/60 transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCwIcon
                className={cn("size-3", syncing && "animate-spin")}
              />
              {failed.length > 0 ? "Try again" : "Send now"}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
