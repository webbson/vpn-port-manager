import type { Db } from "../db.js";
import type { HookRunner } from "./runner.js";
import type { HookPayload } from "./types.js";
import { getExternalIp } from "../services/external-ip.js";

export type HookPayloadBase = Omit<HookPayload, "externalIp">;

// Fetches the cached external IP (5-minute TTL) and merges it into the base
// payload. Exposed so sync.ts retry path can reuse the same lookup.
export async function buildHookPayload(base: HookPayloadBase): Promise<HookPayload> {
  const { ip } = await getExternalIp();
  return { ...base, externalIp: ip };
}

// Fires every hook attached to `mappingId` with the given payload, persists
// each hook's last-run status + error, and emits a hook_fire sync_log entry
// per hook so /logs shows what happened.
//
// Callers: POST /create (src/routes/ui.ts), POST /mappings (src/routes/api.ts),
// sync watchdog recycle/expire path (src/sync.ts), and the per-hook "Test"
// endpoint on /edit/:id.
export interface FireHooksOptions {
  // Optional set of hook IDs. When provided, only hooks whose id is in the
  // set will be fired. Used by the /edit flow to fire only newly-added hooks
  // without re-spamming existing ones.
  hookIds?: Set<string>;
}

export async function fireHooksForMapping(
  db: Db,
  runner: HookRunner,
  mappingId: string,
  payload: HookPayloadBase,
  opts: FireHooksOptions = {}
): Promise<void> {
  const all = db.listHooks(mappingId);
  const hooks = opts.hookIds ? all.filter((h) => opts.hookIds!.has(h.id)) : all;
  if (hooks.length === 0) return;
  const fullPayload = await buildHookPayload(payload);
  for (const hook of hooks) {
    try {
      const result = await runner.execute(
        { type: hook.type, config: hook.config },
        fullPayload
      );
      db.updateHookStatus(hook.id, result.success ? "ok" : "error", result.error);
      db.logSync("hook_fire", mappingId, {
        hookId: hook.id,
        type: hook.type,
        status: result.success ? "ok" : "error",
        error: result.error ?? null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      db.updateHookStatus(hook.id, "error", message);
      db.logSync("hook_fire", mappingId, {
        hookId: hook.id,
        type: hook.type,
        status: "error",
        error: message,
      });
    }
  }
}
