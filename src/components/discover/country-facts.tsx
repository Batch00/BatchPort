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
  title,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Overrides the hover tooltip; falls back to the category label. Used to
   * reveal fuller names the chip abbreviates (e.g. "EUR" -> "Euro"). */
  title?: string;
  children: string;
}) {
  return (
    <span
      title={title ?? label}
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

  const shownCurrencies = facts.currencies.slice(0, 2);
  const currency = shownCurrencies.map((entry) => entry.code).join(" · ");
  // Tooltip reveals the fuller currency names ("EUR" -> "Euro"); falls back to
  // the code when a name was not resolved.
  const currencyTitle = shownCurrencies
    .map((entry) => entry.name ?? entry.code)
    .join(" · ");
  const languages = facts.languages.slice(0, 3).join(", ");
  const languagesTitle =
    facts.languages.length > 3 ? facts.languages.join(", ") : undefined;
  const driving =
    facts.drivingSide === "left" || facts.drivingSide === "right"
      ? `Drives on the ${facts.drivingSide}`
      : null;
  const plugParts = [
    facts.plugTypes.slice(0, 2).join(", "),
    facts.voltage !== null ? `${facts.voltage}V` : "",
  ].filter(Boolean);
  const plug = plugParts.join(" · ");
  // The chip caps plug types at two; the tooltip lists every one it knows.
  const plugTitle =
    facts.plugTypes.length > 2
      ? [facts.plugTypes.join(", "), facts.voltage !== null ? `${facts.voltage}V` : ""]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  if (!currency && !languages && !driving && !plug) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {currency ? (
        <FactChip icon={BanknoteIcon} label="Currency" title={currencyTitle}>
          {currency}
        </FactChip>
      ) : null}
      {languages ? (
        <FactChip icon={LanguagesIcon} label="Languages" title={languagesTitle}>
          {languages}
        </FactChip>
      ) : null}
      {driving ? (
        <FactChip icon={CarIcon} label="Driving side">
          {driving}
        </FactChip>
      ) : null}
      {plug ? (
        <FactChip icon={PlugIcon} label="Plugs and voltage" title={plugTitle}>
          {plug}
        </FactChip>
      ) : null}
    </div>
  );
}
