import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8 text-center">
      <div className="space-y-4">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Batch<span className="text-brand">Port</span>
        </h1>
        <p className="text-muted-foreground mx-auto max-w-md text-lg text-balance">
          Track every place you have been and map where you are headed next.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
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
          className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
        >
          Try a Demo
        </Link>
      </div>
    </main>
  );
}
