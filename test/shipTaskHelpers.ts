import type { SessionManager } from "../src/server/sessions/manager.ts";
/** Explicit confirmation for legacy tests focused on prompt delivery rather than task completion. */
export async function shipAnyway(manager: SessionManager, id: string) {
  const result = await manager.ship(id);
  return result.preflight ? manager.ship(id, { confirmation: result.preflight.token }) : result;
}
