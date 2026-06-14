import Link from "next/link";

import { Globe } from "@/components/map/globe";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <section className="relative h-dvh w-full overflow-hidden">
      <Globe />

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

          <div className="pointer-events-auto flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-brand text-brand-foreground hover:bg-brand/90",
              )}
            >
              Sign in
            </Link>
            <Link
              href="/demo"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "border-white/15 bg-white/5 backdrop-blur-sm hover:bg-white/10",
              )}
            >
              Try a Demo
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
