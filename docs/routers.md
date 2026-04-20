# Adding a Router

Routers translate "expose `vpnPort` at my VPN exit IP to `destIp:destPort` on the LAN" into whatever NAT/firewall primitives the specific device uses. The app treats the router's native identifiers as an opaque JSON blob called a **handle**, stored per mapping in `port_mappings.router_handle`.

Each router lives in a self-contained folder under `src/routers/<id>/` and is wired through `src/routers/registry.ts`.

## The contract — `RouterClient`

Defined in `src/routers/types.ts`:

```ts
type Protocol = "tcp" | "udp" | "tcp_udp";

interface PortForwardSpec {
  vpnPort: number;
  destIp: string;
  destPort: number;
  protocol: Protocol;
  label: string;
}

type RouterHandle = Record<string, string | number | null>;

interface RouterClient {
  name: string;
  login(): Promise<void>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
  ensurePortForward(spec: PortForwardSpec): Promise<RouterHandle>;
  updatePortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle>;
  deletePortForward(handle: RouterHandle): Promise<void>;
  repairPortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle>;
}
```

Semantics:

| Method | When it runs | Must be |
|---|---|---|
| `login` | Sync watchdog tick, before any other call. | Idempotent; safe to call repeatedly. |
| `testConnection` | `POST /api/settings/router/test`, dashboard load. | Non-mutating. |
| `ensurePortForward` | `POST /create` / `POST /api/mappings` | Create the rules; return a handle unique to this mapping. |
| `updatePortForward` | `POST /edit/:id` and when the provider recycles a port in sync. | Mutate existing rules to match the new spec; return a possibly-updated handle. |
| `deletePortForward` | `POST /delete/:id` and dangling-port cleanup. | Best-effort; ignore "not found" errors. |
| `repairPortForward` | Every sync watchdog tick (`src/sync.ts:checkRouterRules`). | Idempotent: if rules are missing, recreate them; if present, verify and return the handle unchanged. |

**The handle shape is private to the router.** UniFi's is `{ dnatId, firewallId }`; a different router might use `{ ruleId }` or `{ natRuleId, acceptRuleId, wanInterface }`. The caller persists whatever you return and hands it back unchanged.

## File layout

```
src/routers/<id>/
  client.ts       — factory returning RouterClient; all network calls
  schema.ts       — zod schema + describeStored (redacts password)
  view.ts         — HTML fields + client-side reader (plus optional discover())
  index.ts        — exports RouterDefinition wiring the above
  discovery.ts    — OPTIONAL: fetches interfaces/zones/VLANs for the UI selects
```

Then register it in `src/routers/registry.ts`.

## Step-by-step: adding a router

Use `src/routers/unifi/` as the reference.

### 1. `client.ts`

Implement the six methods above. Keep login/session state *inside* the factory's closure — the factory is re-called on every `runtime.reloadRouter()` so there's no need to invalidate caches externally.

```ts
import type { RouterClient, RouterHandle, PortForwardSpec } from "../types.js";

export function create<Id>Router(settings: <Id>Settings): RouterClient {
  let session: string | null = null;

  async function loggedRequest(path: string, init?: RequestInit) {
    if (!session) await login();
    // ... retry once on 401 by re-logging in
  }

  async function login() { /* obtain cookie/token, store in `session` */ }

  return {
    name: "<id>",
    login,
    async testConnection() { /* lightweight call, e.g. GET site info */ },
    async ensurePortForward(spec) { /* create N underlying rules, return handle */ },
    async updatePortForward(handle, spec) { /* PATCH each underlying rule */ },
    async deletePortForward(handle) { /* DELETE each rule, swallow 404 */ },
    async repairPortForward(handle, spec) {
      // Look up each handle ID. Any missing? Recreate, returning a handle with
      // the new IDs. All present? Return `handle` unchanged.
    },
  };
}
```

Guarantees you should provide:

- **`ensurePortForward` is safe to retry.** If the first call partially succeeded and a retry happens, make sure the second call reconciles rather than duplicates. The simplest approach: query for rules matching the mapping label before creating.
- **`deletePortForward` never throws on "already gone".** Users can delete rules manually through the router UI; sync and delete paths must tolerate that.
- **`repairPortForward` may return a different handle.** Callers (`src/sync.ts`, `src/routes/ui.ts`) compare the returned handle to the previous one and update the DB row if it changed.

### 2. `schema.ts`

```ts
import { z } from "zod";

export const <id>RouterSchema = z.object({
  type: z.literal("<id>"),
  host: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  // plus any router-specific selections (interface ID, zone IDs, VLAN, etc.)
});
export type <Id>RouterSettings = z.infer<typeof <id>RouterSchema>;

export function describe<Id>(s: <Id>RouterSettings): Record<string, unknown> {
  // Return everything EXCEPT password. GET /api/settings/router uses this.
  return { type: s.type, host: s.host, username: s.username, /* ... */ };
}
```

### 3. `view.ts`

Same pattern as providers: `<id>Fields(stored)` returns an HTML fragment; `<id>ReaderScript` is a string of JS that defines `read<Id>Form(opts)`. If your router supports discovery, `view.ts` should also define a `discover<Id>()` function that POSTs to `/api/settings/router/discover` and populates the selects.

Secrets: don't pre-fill `<input type="password">`. Show the placeholder `"•••• (stored, leave blank to keep)"` and have the reader throw only when `opts.requireSecret` is true.

### 4. `discovery.ts` (optional)

If the router exposes a listing API (interfaces, zones, etc.), put a `discover<Id>(creds)` function here. It's called from `index.ts` via the `discover` hook on `RouterDefinition`.

Discovery runs server-side — `POST /api/settings/router/discover` merges the stored password when the body omits it, so the user doesn't need to retype it to refresh the selects. See `src/routes/settings.ts` `POST /router/discover`.

### 5. `index.ts`

```ts
import type { RouterDefinition } from "../registry.js";
import { create<Id>Router } from "./client.js";
import { <id>RouterSchema, describe<Id>, type <Id>RouterSettings } from "./schema.js";
import { <ID>_READER_NAME, <id>Fields, <id>ReaderScript } from "./view.js";
import { discover<Id> } from "./discovery.js"; // if present

export const <id>Definition: RouterDefinition<<Id>RouterSettings> = {
  id: "<id>",
  label: "<Human-readable name>",
  schema: <id>RouterSchema,
  create: create<Id>Router,
  describeStored: describe<Id>,
  renderFields: (stored) => <id>Fields(stored),
  readerName: <ID>_READER_NAME,
  readerScript: <id>ReaderScript,
  discover: async (body) => {
    const b = body as { host?: string; username?: string; password?: string };
    if (!b.host || !b.username || !b.password) return { ok: false, error: "missing creds" };
    try {
      return { ok: true, ...(await discover<Id>({ host: b.host, username: b.username, password: b.password })) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
```

### 6. Register it

In `src/routers/registry.ts` append to `routerDefinitions`, and switch `routerSettingsSchema` to `z.discriminatedUnion("type", [...])` once a second router exists.

### 7. Tests

Add `tests/routers/<id>.test.ts`. Mock `fetch` and cover:

- `login()` happy path + 401 retry;
- `ensurePortForward` creating all underlying rules and returning the handle;
- `updatePortForward` mutating in place (no orphan rules);
- `deletePortForward` swallowing 404;
- `repairPortForward` detecting a missing rule and recreating it, returning a handle whose IDs differ from the input.

`tests/routers/unifi.test.ts` is the reference.

## Legacy handle migration

If you rename the handle shape after shipping, add a migration in `src/db.ts:migrateLegacyRouterHandle` — the UniFi migration from `unifi_dnat_id` / `unifi_firewall_id` columns to the unified `router_handle` JSON is the example to follow.

## Verification

```bash
pnpm build && pnpm test
pnpm dev
# /settings → pick the new router → Test → Discover (if supported) → Save
# /create → create a mapping → verify rules appear in the router's own UI
# /edit/:id → change destIp → verify the rule updated in place (same handle IDs)
# /delete/:id → verify rules disappear from the router's UI
# Wait one sync interval → logs show no "router_repair" churn
```
