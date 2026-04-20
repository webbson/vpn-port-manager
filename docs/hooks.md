# Hooks

Hooks are called whenever a port mapping changes state — created, port recycled, or deleted. They're the integration point for updating downstream services (Plex, Transmission, Sonarr, monitoring, chat notifications, scripts) when a VPN port moves.

## Hook types

Two types, all defined in `src/hooks/runner.ts`:

| Type | Use when |
|---|---|
| `plugin` | You have a first-class integration with a specific service (e.g. Plex). Logic lives in `src/hooks/plugins/<name>.ts`. |
| `webhook` | You want to send the payload as JSON to an arbitrary HTTP endpoint (POST/GET/PUT with optional custom headers). |

All three receive the same `HookPayload`:

```ts
interface HookPayload {
  mappingId: string;     // stable UUID for the mapping
  label: string;         // user-chosen label
  oldPort: number | null; // previous VPN port (null on create)
  newPort: number | null; // new VPN port     (null on delete)
  destIp: string;        // LAN destination IP
  destPort: number;      // LAN destination port
}
```

## When hooks fire

Called from `src/routes/api.ts`, `src/routes/ui.ts`, and `src/sync.ts`:

| Event | `oldPort` | `newPort` |
|---|---|---|
| Mapping created | `null` | new port |
| Port recycled (renewal or provider drift) | previous port | new port |
| Mapping deleted | previous port | `null` |

The sync watchdog also retries hooks whose last run recorded `status: "error"` (`src/sync.ts:retryFailedHooks`), so transient failures self-heal.

## `webhook` — HTTP request

Config shape (JSON-stringified and stored in the `hooks` table):

```json
{
  "url": "https://example.com/vpn-port-changed",
  "method": "POST",
  "headers": { "X-Api-Key": "secret" }
}
```

`method` defaults to `POST` (GET/PUT are also selectable in the UI); `headers` is optional (merged on top of `Content-Type: application/json`). The body is the raw `HookPayload` object serialized as JSON. Non-2xx responses mark the hook `error` with the status line. The hook-builder renders a live "Example request" preview so you can see exactly what goes over the wire.

## `plugin` — built-in integrations

Plugin hooks route to a named implementation under `src/hooks/plugins/`. In the UI each registered plugin appears as its own hook type (alongside **Webhook**), so picking **Plex** is a single click — the nested `plugin` indirection happens automatically at save time.

### Plex

Config stored in the DB:

```json
{ "plugin": "plex", "token": "<X-Plex-Token>" }
```

On every port change the runner PUTs `http://{destIp}:{destPort}/:/prefs?ManualPortMappingPort={newPort}&X-Plex-Token={token}` (no call when `newPort` is `null`, i.e. on delete). The Plex URL is derived from the mapping's destination IP and port — there's no separate server-URL field.

**Where to find your X-Plex-Token**: in the Plex web UI, play any item → **…** (More) → **Get Info** → **View XML**. A new tab opens with a URL containing `X-Plex-Token=…` — copy that value. Official guide: <https://support.plex.tv/articles/204059436>.

**Container networking**: the derived URL is fetched from *inside* this container. If Plex runs on the Docker host itself, the mapping's destination IP must be reachable from inside the container — use the LAN IP, the Docker bridge gateway, or put both containers on the same user-defined network. Test quickly with `docker compose exec vpn-port-manager wget -qO- http://<destIp>:<destPort>/identity`.

### Adding a plugin

1. **Create `src/hooks/plugins/<name>.ts`** implementing `HookPlugin` from `src/hooks/types.ts`:

   ```ts
   import type { HookPlugin, HookPayload, HookResult } from "../types.js";

   export const <name>Plugin: HookPlugin = {
     name: "<name>",
     async execute(config: Record<string, any>, payload: HookPayload): Promise<HookResult> {
       if (payload.newPort === null) return { success: true }; // ignore deletes if you like
       try {
         const res = await fetch(`${config.host}/some/path?port=${payload.newPort}`, {
           method: "POST",
           headers: { Authorization: `Bearer ${config.token}` },
         });
         if (!res.ok) {
           return { success: false, error: `<name> error (${res.status}): ${res.statusText}` };
         }
         return { success: true };
       } catch (err: unknown) {
         const message = err instanceof Error ? err.message : String(err);
         return { success: false, error: `<name> connection error: ${message}` };
       }
     },
   };
   ```

2. **Register it** in `src/hooks/runner.ts`:

   ```ts
   import { <name>Plugin } from "./plugins/<name>.js";

   const plugins: Record<string, HookPlugin> = {
     plex: plexPlugin,
     <name>: <name>Plugin,
   };
   ```

3. **Tests** — add `tests/hooks/plugins/<name>.test.ts`. Mock `fetch` with `vi.stubGlobal` and cover happy path, non-2xx response, connection error, and the `newPort === null` skip.

4. **UI** — add a descriptor to `src/hooks/plugins/registry.ts` (`hookPluginDescriptors`) declaring the `id` (same as the runner key), `label`, a one-line `description`, and a `fields` array with `name` / `label` / `placeholder` / `help` / `required` / `type` for each input. The hook-builder picks it up automatically — it becomes a first-class option in the Type dropdown and renders the listed fields with inline help text. No changes to `create.ts` or `edit.ts` are needed.

## Error handling and retries

Plugins/webhooks/commands return `{ success: boolean; error?: string }` — never throw. The runner persists the latest status per-hook in the `hooks` table (`lastStatus`, `lastError`). The dashboard currently only shows an aggregate status, but `GET /api/mappings` and `GET /api/logs` both surface per-hook error text.

The sync watchdog retries hooks with `lastStatus === "error"` on every tick, so a Plex server that's restarting will self-heal within one sync interval (`AppSettings.syncIntervalMinutes`, default 15 minutes). If a hook is permanently misconfigured, it'll keep retrying — there's no exponential backoff. Delete the hook or fix the config to stop the retries.

## Security notes

- **Webhook URL** is not validated beyond shape. Outbound requests originate from inside the container's network — be mindful if you deploy it somewhere with access to internal services.
- **Plugin config** is stored plaintext in the SQLite `hooks` table. Only app-level settings (VPN/router credentials) are encrypted. Don't store long-lived secrets in hook configs if you can avoid it.
