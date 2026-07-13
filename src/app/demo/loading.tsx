import { SharedProfileSkeleton } from "@/components/share/shared-profile-skeleton";

export default function DemoLoading() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a]">
      <div className="h-12 border-b border-white/10" />
      <SharedProfileSkeleton />
    </div>
  );
}
