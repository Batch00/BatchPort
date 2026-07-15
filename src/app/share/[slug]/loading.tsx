import { SharedProfileSkeleton } from "@/components/share/shared-profile-skeleton";

export default function ShareLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <div className="box-content h-12 border-b border-white/10 pt-[env(safe-area-inset-top)]" />
      <SharedProfileSkeleton />
    </div>
  );
}
