import { createClient } from "@/utils/supabase/server";

// Placeholder dashboard. Confirms the auth flow works end to end by showing the
// signed-in user's email. The globe and the real dashboard get wired in here
// later.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-col gap-2 p-8 sm:p-12">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-sm text-foreground/60">
        Signed in as {user?.email}
      </p>
    </div>
  );
}
