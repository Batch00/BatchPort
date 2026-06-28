import Link from "next/link";
import type { Metadata } from "next";

import {
  getShareMeta,
  getSharedProfile,
  getUserBySlug,
} from "@/lib/share-data";
import { SharedProfileView } from "@/components/share/shared-profile-view";

interface SharePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: SharePageProps): Promise<Metadata> {
  const { slug } = await params;
  const userId = await getUserBySlug(slug);
  if (!userId) {
    return { title: "Profile not shared | BatchPort" };
  }
  const meta = await getShareMeta(userId);
  const title = `${slug}'s Travel Map | BatchPort`;
  const description = `${meta.countries} countries visited across ${meta.trips} trips. Explore the interactive travel map.`;
  // og:image is skipped: there is no dynamic image generator yet.
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function SharePage({ params }: SharePageProps) {
  const { slug } = await params;
  const userId = await getUserBySlug(slug);

  if (!userId) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#0a0a0a] p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Profile not found
        </h1>
        <p className="max-w-sm text-sm text-foreground/60">
          This profile is not shared or does not exist.
        </p>
        <Link
          href="/"
          className="text-sm text-brand underline-offset-4 hover:underline"
        >
          Go to BatchPort
        </Link>
      </main>
    );
  }

  const profile = await getSharedProfile(userId);

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Batch<span className="text-brand">Port</span>
        </Link>
        <span className="text-sm text-foreground/60">{slug}</span>
      </header>

      <main className="flex-1">
        <SharedProfileView profile={profile} />
      </main>

      <footer className="border-t border-white/10 px-4 py-4 text-center text-xs text-foreground/40 sm:px-6">
        Powered by{" "}
        <Link href="/" className="text-foreground/60 hover:text-foreground">
          BatchPort
        </Link>
      </footer>
    </div>
  );
}
