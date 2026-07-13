// Skeleton mirroring the settings page: heading, share toggle card, slug field.
export default function SettingsLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-pulse p-6 sm:p-8">
      <div className="mb-6 h-4 w-36 rounded bg-white/5" />
      <div className="mb-2 h-7 w-28 rounded bg-white/5" />
      <div className="mb-8 h-4 w-64 rounded bg-white/5" />
      <div className="flex flex-col gap-6">
        <div className="h-20 rounded-xl bg-white/5" />
        <div className="h-16 rounded-xl bg-white/5" />
        <div className="h-9 w-32 rounded-lg bg-white/5" />
      </div>
    </div>
  );
}
