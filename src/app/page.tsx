import { Globe } from "@/components/map/globe";
import { LandingActions } from "@/components/auth/landing-actions";
import { getLandingGlobeData } from "@/lib/landing-data";
import { buildMockGlobeProps } from "@/lib/mock-travel-data";

export default async function Home() {
  // The public demo account's real world, cached for an hour, with a bundled
  // snapshot of the same trips behind it. Resolved here on the server so the
  // globe mounts once with its final data: there is no client-side swap and so
  // no flash between the two.
  const globeData = (await getLandingGlobeData()) ?? buildMockGlobeProps();

  return (
    <section className="relative h-dvh w-full overflow-hidden">
      <Globe
        visitedCountryCodes={globeData.visitedCountryCodes}
        destinations={globeData.destinations}
        arcs={globeData.arcs}
      />

      {/* Dark gradient backdrop so the hero copy stays readable over the map. */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-black/85 via-black/45 to-transparent" />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-center p-8 sm:p-16">
        <div className="max-w-xl space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
              Batch<span className="text-brand">Port</span>
            </h1>
            <p className="max-w-md text-lg text-balance text-foreground/70">
              Track every place you have been and map where you are headed next.
            </p>
          </div>

          <LandingActions />
        </div>
      </div>
    </section>
  );
}
