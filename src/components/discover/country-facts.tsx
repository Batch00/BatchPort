"use client";

import {
  BanknoteIcon,
  CarIcon,
  ClockIcon,
  LanguagesIcon,
  PlugIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/ui/info-tip";
import type { CountryFacts } from "@/lib/discover";

// Compact labeled chips for a country's practical facts (currency, languages,
// driving side, plug/voltage). Best-effort by design: chips for missing
// properties simply do not render, and a facts object with nothing to show
// renders nothing at all.
//
// Chips that abbreviate their value carry an InfoTip with the full text, which
// works on touch as well as hover. A chip with nothing extra to reveal stays a
// plain span: it should not be focusable or look pressable.

const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-foreground/70";

function FactChip({
  icon: Icon,
  label,
  tip,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Full text for a value the chip abbreviates (e.g. "EUR" -> "Euro"). */
  tip?: string;
  children: string;
}) {
  const body = (
    <>
      <Icon className="size-3 shrink-0 text-brand/80" />
      {children}
    </>
  );

  if (!tip) {
    return (
      <span className={CHIP_CLASS} aria-label={`${label}: ${children}`}>
        {body}
      </span>
    );
  }

  return (
    <InfoTip
      tip={tip}
      label={`${label}: ${children}. Show full details`}
      className={cn(CHIP_CLASS, "hover:border-brand/30 hover:bg-white/10")}
    >
      {body}
    </InfoTip>
  );
}

// "3 hours ahead of home" / "45 minutes behind home". Only rendered when a
// home location is set and both timezones resolved, so there is no "same as
// home, probably" hedging to write.
function timezoneChipText(offsetHours: number): string {
  if (offsetHours === 0) return "Same time as home";
  const direction = offsetHours > 0 ? "ahead of" : "behind";
  const total = Math.abs(offsetHours);
  const whole = Math.floor(total);
  const minutes = Math.round((total - whole) * 60);
  const parts: string[] = [];
  if (whole > 0) parts.push(`${whole} ${whole === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} min`);
  return `${parts.join(" ")} ${direction} home`;
}

export function CountryFactsRow({
  facts,
  timezoneOffsetHours,
  className,
}: {
  facts: CountryFacts | null | undefined;
  /** Hours ahead of the user's home. Undefined or null renders no chip, which
   * covers both "no home set" and "could not resolve". */
  timezoneOffsetHours?: number | null;
  className?: string;
}) {
  if (!facts) return null;

  const shownCurrencies = facts.currencies.slice(0, 2);
  // A single named currency is short enough to just show: "Euro" beats "EUR"
  // behind a tap. Two currencies, or a code whose name never resolved, fall
  // back to the codes with the full text in a tip.
  const soleCurrencyName =
    shownCurrencies.length === 1 ? shownCurrencies[0].name : null;
  const currency =
    soleCurrencyName ?? shownCurrencies.map((entry) => entry.code).join(" · ");
  const currencyNames = shownCurrencies
    .map((entry) => entry.name ?? entry.code)
    .join(" · ");
  const currencyTip =
    soleCurrencyName || currencyNames === currency ? undefined : currencyNames;

  const languages = facts.languages.slice(0, 3).join(", ");
  const languagesTip =
    facts.languages.length > 3 ? facts.languages.join(", ") : undefined;

  const driving =
    facts.drivingSide === "left" || facts.drivingSide === "right"
      ? `Drives on the ${facts.drivingSide}`
      : null;

  const voltage = facts.voltage !== null ? `${facts.voltage}V` : "";
  const plugParts = [facts.plugTypes.slice(0, 2).join(", "), voltage].filter(
    Boolean,
  );
  const plug = plugParts.join(" · ");
  // The chip caps plug types at two; the tip lists every one it knows.
  const plugTip =
    facts.plugTypes.length > 2
      ? [`Plug types ${facts.plugTypes.join(", ")}`, voltage]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  const timezone =
    typeof timezoneOffsetHours === "number"
      ? timezoneChipText(timezoneOffsetHours)
      : null;

  if (!currency && !languages && !driving && !plug && !timezone) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {timezone ? (
        <FactChip icon={ClockIcon} label="Time difference">
          {timezone}
        </FactChip>
      ) : null}
      {currency ? (
        <FactChip icon={BanknoteIcon} label="Currency" tip={currencyTip}>
          {currency}
        </FactChip>
      ) : null}
      {languages ? (
        <FactChip icon={LanguagesIcon} label="Languages" tip={languagesTip}>
          {languages}
        </FactChip>
      ) : null}
      {driving ? (
        <FactChip icon={CarIcon} label="Driving side">
          {driving}
        </FactChip>
      ) : null}
      {plug ? (
        <FactChip icon={PlugIcon} label="Plugs and voltage" tip={plugTip}>
          {plug}
        </FactChip>
      ) : null}
    </div>
  );
}
