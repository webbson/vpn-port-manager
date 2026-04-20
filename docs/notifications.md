# Notifications

Notifications are **app-global status pushes** for events the user usually wants to know about: sync failures, port renewals, router rule repair errors, user-action failures. They're distinct from **hooks** — hooks are per-mapping and fire only on port-mapping lifecycle events, whereas notifications cover the whole app and fire whenever something noteworthy happens regardless of which mapping (if any) is involved.

## Relationship to hooks

| | Hooks | Notifications |
|---|---|---|
| Scope | Per port mapping | App-global (one config) |
| Triggers | Port created / recycled / deleted | Sync errors, renewals, router repair failures, user-action failures, … |
| Payload | `HookPayload` (mapping-specific) | `NotificationEvent` (category + severity + title/message) |
| Storage | `hooks` table, plaintext | `settings.notifications`, encrypted |
| Failure policy | Recorded in `hooks.lastStatus`; retried every sync tick | Logged to `sync_log` with `action=notify`; never retried |

## Backends

Currently only **ntfy**. New backends plug into the same registry as VPN providers and routers — see [Adding a backend](#adding-a-backend).

## Event model

```ts
type NotificationCategory =
  | "port.renewed"
  | "port.expired"
  | "port.recreated"
  | "port.recreate_failed"
  | "router.repair_failed"
  | "provider.login_failed"
  | "mapping.create_failed"
  | "mapping.update_failed"
  | "mapping.delete_failed";

interface NotificationEvent {
  category: NotificationCategory;
  severity: "info" | "warning" | "error";
  title: string;                          // short headline, rendered as ntfy Title
  message: string;                        // body text
  mappingId?: string;                     // present when the event relates to a specific mapping
  data?: Record<string, unknown>;         // structured extras (logged, not shown by default)
}
```

Each event flows through a **`NotifierDispatcher`** (`src/notifications/dispatcher.ts`) which:

1. Short-circuits when notifications are disabled or no backend is configured (→ `createNoopDispatcher()`).
2. Filters by per-category toggle. Categories absent from the user's saved map default to **ON**, so future categories aren't silently suppressed.
3. Calls `notifier.send(event)` **fire-and-forget**: the returned promise is consumed inside the dispatcher and failures are logged to `sync_log` — they never propagate into the caller's hot path (sync tick, HTTP response).

## Where events fire

All call sites pass through `runtime.getNotifier().emit(…)`:

| File | Category | When |
|---|---|---|
| `src/sync.ts` | `port.expired` | Sync detects a mapping whose port is no longer at the provider and the lease has expired |
| `src/sync.ts` | `port.recreated` | Sync recreates a port that vanished from the provider before it expired |
| `src/sync.ts` | `port.recreate_failed` | Sync tried to recreate a missing port and the provider call threw |
| `src/sync.ts` | `port.renewed` | Renewal tick swapped an expiring port (`renewThresholdDays`) |
| `src/sync.ts` | `router.repair_failed` | `router.repairPortForward` threw |
| `src/sync.ts` | `provider.login_failed` | `router.login()` threw at the top of a sync tick |
| `src/routes/api.ts`, `src/routes/ui.ts` | `mapping.create_failed` | Router rule creation threw during user-initiated create |
| `src/routes/api.ts`, `src/routes/ui.ts` | `mapping.update_failed` | Router rule update threw during user-initiated edit |
| `src/routes/api.ts`, `src/routes/ui.ts` | `mapping.delete_failed` | Provider deletePort and/or router deletePortForward threw during user-initiated delete (one event, both errors combined) |

**Not notified** (by design): successful user-initiated create/update/delete. Those succeed silently; notifications only fire on failures for user-driven flows. Sync-driven state changes (renewed, recreated, expired) *do* notify because the user isn't watching them happen.

## ntfy

Config stored in the `settings` table as encrypted JSON:

```json
{
  "provider": "ntfy",
  "serverUrl": "https://ntfy.sh",
  "topic": "my-topic",
  "bearerToken": "tk_…",
  "priority": 3,
  "defaultTags": ["vpn", "portmanager"]
}
```

| Field | Required | Notes |
|---|---|---|
| `serverUrl` | yes | Public ntfy.sh or self-hosted. Trailing slashes stripped. |
| `topic` | yes | URL-encoded before appending; spaces and Unicode work. |
| `bearerToken` | no | Sent as `Authorization: Bearer …` when present. Leaving the UI field blank on save **preserves the stored token** (the PUT endpoint merges). |
| `priority` | no | 1–5. Override the severity-derived default. |
| `defaultTags` | no | Appended to every request's `Tags` header after the severity tag. |

**HTTP call per event**: `POST {serverUrl}/{topic}` with headers `Title`, `Priority`, `Tags`, optional `Authorization`, and the event's `message` as the body.

**Severity → ntfy mapping** (when `settings.priority` is unset):

| Severity | Priority | Tag |
|---|---|---|
| `info` | 3 | `information_source` |
| `warning` | 4 | `warning` |
| `error` | 5 | `rotating_light` |

## Adding a backend

Each backend is self-contained under `src/notifications/{id}/`, mirroring the provider/router patterns.

1. **Create `src/notifications/{id}/client.ts`** implementing `Notifier` from `../types.ts`:

   ```ts
   import type { Notifier, NotificationEvent } from "../types.js";
   import type { XyzSettings } from "./schema.js";

   export function createXyzNotifier(settings: XyzSettings): Notifier {
     return {
       async send(event: NotificationEvent): Promise<void> {
         // POST / SDK call. Throw on non-success; the dispatcher catches.
       },
       async test(): Promise<void> {
         // A minimal probe. Called by POST /api/settings/notifications/test.
       },
     };
   }
   ```

2. **Create `src/notifications/{id}/schema.ts`** — zod schema with `provider: z.literal("{id}")`, the `Settings` type, and a `describeStored(s)` helper that returns non-secret fields for `GET /api/settings/notifications`. Anything sensitive (tokens, passwords) must be redacted to a boolean flag like `hasBearerToken`.

3. **Create `src/notifications/{id}/view.ts`** — `renderFields(stored)` HTML fragment and a `readerScript` string defining `read{Id}Form(opts)` in the browser. Secrets should:
   - Render a placeholder input (no `value=…`) when `stored !== null`, with copy like `"•••••• (stored, leave blank to keep)"`.
   - Omit the secret field from the reader's return value when the input is blank, so the PUT endpoint can merge stored.

4. **Create `src/notifications/{id}/index.ts`** — export a `NotifierDefinition` wiring the above:

   ```ts
   import type { NotifierDefinition } from "../registry.js";
   import { createXyzNotifier } from "./client.js";
   import { describeXyz, xyzSettingsSchema, type XyzSettings } from "./schema.js";
   import { XYZ_READER_NAME, xyzFields, xyzReaderScript } from "./view.js";

   export const xyzDefinition: NotifierDefinition<XyzSettings> = {
     id: "xyz",
     label: "XYZ",
     schema: xyzSettingsSchema,
     create: (s) => createXyzNotifier(s),
     describeStored: describeXyz,
     renderFields: (stored) => xyzFields(stored),
     readerName: XYZ_READER_NAME,
     readerScript: xyzReaderScript,
   };
   ```

5. **Register it** in `src/notifications/registry.ts` by adding it to `notifierDefinitions`. Once two backends exist, switch `notifierSettingsSchema` to `z.discriminatedUnion("provider", [...])` — exactly the same pattern as `providers/registry.ts` and `routers/registry.ts`.

6. **Merge secret on save** (if your backend has one): extend the conditional in `PUT /api/settings/notifications` (`src/routes/settings.ts`) that preserves the bearer token when the body omits it. Alternatively, have your backend's `describeStored` omit the secret entirely and handle "blank = keep" in the reader via a flag — the current ntfy impl chose server-side merge for simplicity.

7. **Tests** — `tests/notifications/{id}.test.ts` with `vi.stubGlobal("fetch", …)`. Cover: happy path, headers, severity → priority mapping, auth header, non-2xx failure, and `test()`. See `tests/notifications/ntfy.test.ts` for the template.

No changes to views, routes, or the dispatcher are needed — they iterate the registry.

## Security notes

- **Backend credentials** (ntfy bearer token and equivalents) are encrypted at rest alongside VPN and router settings. Rotating `APP_SECRET_KEY` invalidates them.
- **`describeStored` is the redaction boundary.** `GET /api/settings/notifications` returns `describeStored(notifier)`, which must never include secrets. The `/settings` HTML view receives the full settings object for `renderFields` — so per-backend `view.ts` must also avoid embedding secrets in HTML. Current ntfy never renders `bearerToken`; if you add a new backend, mirror that.
- **Test endpoint trust.** `POST /api/settings/notifications/test` accepts a config payload and sends a probe. In a configured app it's behind the same routing middleware as the rest of the API — anyone who can reach `/api/settings` can cause a test push. Not privilege-sensitive for ntfy but worth remembering if you add an SMS/email backend.
- **No retry.** Unlike hooks, failed notifications are logged and forgotten. If a push fails (e.g. ntfy server down), the user won't see a later retry — the event is lost. Consider that when choosing severity: if the event *needs* acknowledgement, a hook is a better fit.
