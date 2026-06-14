"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/utils/supabase/server";

// Server action: clear the Supabase session (cookies are writable here, unlike
// in a Server Component) and return the user to the landing page.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
