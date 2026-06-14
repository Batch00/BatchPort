import { isDemoUser } from "@/lib/demo";
import { requireUser } from "@/lib/current-user";

// Server-only helper shared by the write server actions. Returns true when the
// current user is the read-only demo account, in which case the action must
// refuse the mutation.
export async function isDemoBlocked(): Promise<boolean> {
  const { user } = await requireUser();
  return isDemoUser(user.id);
}
