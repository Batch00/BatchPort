"use client";

import {
  BanknoteIcon,
  CarIcon,
  LanguagesIcon,
  PlugIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { CountryFacts } from "@/lib/discover";

// Compact labeled chips for a country's practical facts (currency, languages,
// driving side, plug/voltage). Best-effort by design: chips for missing
// properties simply do not render, and a facts object with nothing to show
// renders nothing at all.

function FactChip({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: string;
}) {
  return (
    <span
      title={label}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-foreground/70"
    >
      <Icon className="size-3 shrink-0 text-brand/80" />
      {children}
    </span>
  );
}

export function CountryFactsRow({
  facts,
  className,
}: {
  facts: CountryFacts | null | undefined;
  className?: string;
}) {
  if (!facts) return null;

  const currency = facts.currencies.slice(0, 2).join(" · ");
  const languages = facts.languages.slice(0, 3).join(", ");
  const driving =
    facts.drivingSide === "left" || facts.drivingSide === "right"
      ? `Drives on the ${facts.drivingSide}`
      : null;
  const plugParts = [
    facts.plugTypes.slice(0, 2).join(", "),
    facts.voltage !== null ? `${facts.voltage}V` : "",
  ].filter(Boolean);
  const plug = plugParts.join(" · ");

  if (!currency && !languages && !driving && !plug) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {currency ? (
        <FactChip icon={BanknoteIcon} label="Currency">
          {currency}
        </FactChip>
      ) : null}
      {languages ? (
        <FactChip icon={LanguagesIcon} label="Languages">
          {languages}
        </FactChip>
      ) : null}
      {driving ? (
        <FactChip icon={CarIcon} label="Driving side">
          {driving}
        </FactChip>
      ) : null}
      {plug ? (
        <FactChip icon={PlugIcon} label="Plugs and voltage">
          {plug}
        </FactChip>
      ) : null}
    </div>
  );
}
