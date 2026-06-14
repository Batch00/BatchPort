// Shared result shape for server actions that do not redirect on success.
export type ActionResult = { ok: true } | { error: string };
