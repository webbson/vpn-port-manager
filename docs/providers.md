# Adding a VPN Provider

VPN providers expose "give me an externally-forwarded port" primitives. The app stores one port mapping per allocated provider port, syncs against the provider as the source of truth, and fires hooks when a port is created, recycled, or released.

Each provider lives in a self-contained folder under `src/providers/<id>/` and is wired into the app through `src/providers/registry.ts`.

## The contract — `VpnProvider`

Defined in `src/providers/types.ts`:

```ts
interface VpnProvider {
  name: string;
  maxPorts: number;
  listPorts(): Promise<ProviderPort[]>;
  createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort>;
  deletePort(port: number): Promise<void>;
  checkPort(port: number): Promise<boolean>;
}

interface ProviderPort {
  port: number;
  expiresAt: number; // unix timestamp in SECONDS
}
```

Conventions:

- **`expiresAt` is always unix seconds** (not milliseconds). `src/sync.ts` compares it against `Math.floor(Date.now() / 1000)`; `src/views/dashboard.ts:formatExpiry()` multiplies by 1000 before formatting.
- **`maxPorts`** is the account's ceiling. The runtime respects `AppSettings.maxPorts` as an override when the user has set one (see `src/runtime.ts:getMaxPorts`).
- **`listPorts()` is authoritative.** The sync watchdog (`src/sync.ts:checkProviderSync`) treats the provider's list as truth: any DB mapping whose `vpnPort` is missing from `listPorts()` is either marked expired or re-created.
- **`checkPort(port)` must be side-effect free.** It's used by `POST /api/mappings/:id/refresh` to confirm a single port still exists.
- The container must be able to reach the provider's API. Azire, for example, requires requests to originate from a VPN-tunnelled IP.

## File layout

```
src/providers/<id>/
  client.ts   — factory returning VpnProvider; all network calls
  schema.ts   — zod schema + `describeStored` (redacts secrets for GET)
  view.ts     — HTML fields + client-side JS "reader" function
  index.ts    — exports ProviderDefinition wiring the above
```

Then register it in `src/providers/registry.ts`.

## Step-by-step: adding a provider

Use `src/providers/azire/` as the reference implementation.

### 1. `client.ts`

```ts
import type { VpnProvider, ProviderPort } from "../types.js";

export function create<Id>Provider(config: { apiToken: string; /* ... */ }): VpnProvider {
  return {
    name: "<id>",
    maxPorts: 5,
    async listPorts() { /* GET /ports → ProviderPort[] */ },
    async createPort(opts) { /* POST /ports → ProviderPort */ },
    async deletePort(port) { /* DELETE /ports/:port */ },
    async checkPort(port) { /* GET /ports/:port → boolean */ },
  };
}
```

Throw `Error` with the provider's response body on failure — the UI surfaces `err.message` verbatim in the "Test" button and in sync log entries.

### 2. `schema.ts`

```ts
import { z } from "zod";

export const <id>SettingsSchema = z.object({
  provider: z.literal("<id>"),
  apiToken: z.string().min(1),
  // ...other fields
});
export type <Id>Settings = z.infer<typeof <id>SettingsSchema>;

// Redact secrets here. The GET /api/settings/vpn response uses this.
export function describe<Id>(s: <Id>Settings): Record<string, unknown> {
  return { provider: s.provider, /* non-secret fields */ };
}
```

The `provider: z.literal("<id>")` discriminator is what lets the registry eventually switch to `z.discriminatedUnion("provider", [...])` once a second provider is added.

### 3. `view.ts`

Server-rendered HTML fields plus a browser-side reader function. The reader is stringified into the settings page script block, so it must be plain ES5-friendly JS referring to elements by ID.

```ts
export function <id>Fields(stored: <Id>Settings | null): string {
  // Return an HTML fragment. Do NOT include the stored secret — just show a
  // "•••• (stored, leave blank to keep)" placeholder when configured.
}

export const <ID>_READER_NAME = "read<Id>Form";

export const <id>ReaderScript = `
  function ${<ID>_READER_NAME}(opts) {
    const requireSecret = opts && opts.requireSecret;
    const token = document.getElementById('<id>-apiToken').value.trim();
    if (!token && requireSecret) throw new Error('API token required');
    return { provider: '<id>', apiToken: token, /* ... */ };
  }
`;
```

The `requireSecret` flag is `true` when the user hasn't configured this provider yet (initial save) or clicks **Test**, and `false` on subsequent **Save** clicks — that way they can resave without re-typing the token. The settings route leaves the stored token untouched if the body omits `apiToken` — actually no: see [Preserving secrets on partial save](#preserving-secrets-on-partial-save).

### 4. `index.ts`

```ts
import type { ProviderDefinition } from "../registry.js";
import { create<Id>Provider } from "./client.js";
import { <id>SettingsSchema, describe<Id>, type <Id>Settings } from "./schema.js";
import { <ID>_READER_NAME, <id>Fields, <id>ReaderScript } from "./view.js";

export const <id>Definition: ProviderDefinition<<Id>Settings> = {
  id: "<id>",
  label: "<Human-readable name>",
  schema: <id>SettingsSchema,
  create: (s) => create<Id>Provider({ apiToken: s.apiToken /* ... */ }),
  describeStored: describe<Id>,
  renderFields: (stored) => <id>Fields(stored),
  readerName: <ID>_READER_NAME,
  readerScript: <id>ReaderScript,
};

export type { <Id>Settings };
```

### 5. Register it

In `src/providers/registry.ts` append to `providerDefinitions`:

```ts
export const providerDefinitions: ProviderDefinition[] = [
  azireDefinition as ProviderDefinition,
  <id>Definition as ProviderDefinition,
];
```

And switch `vpnSettingsSchema` to a discriminated union:

```ts
export const vpnSettingsSchema = z.discriminatedUnion("provider", [
  azireDefinition.schema,
  <id>Definition.schema,
]);
```

The registry is iterated by `src/views/settings.ts`, `src/routes/settings.ts`, and `src/providers/index.ts:createProvider` — no other call sites need edits.

### 6. Tests

Add `tests/providers/<id>.test.ts`. Mock `fetch` with `vi.stubGlobal("fetch", ...)` and assert URL, headers, body, and the parsed `ProviderPort` shape. See `tests/providers/azire.test.ts` for the pattern.

## Preserving secrets on partial save

Today the settings service always writes what `vpnSettingsSchema.parse()` accepts. If a provider's schema marks `apiToken` as required, submitting the save form with a blank token will fail validation — which is why the reader throws a clear error when `requireSecret` is set. For subsequent saves where the user isn't touching the secret, the current UI calls the reader with `requireSecret: false`, meaning the token field can be empty and validation will reject it.

If you want partial saves (keep stored token on blank), you have two options:

1. Make `apiToken` optional in the schema and handle merge at the route level (read stored, merge, re-parse).
2. Add a `"placeholder-secret"` sentinel the UI sends when blank, then swap in the stored value inside `PUT /api/settings/vpn` before calling `settings.setVpn`.

The UniFi router already does approach (2) for discovery — see `src/routes/settings.ts` `POST /router/discover`.

## Verification

After wiring a new provider:

```bash
pnpm build && pnpm test
pnpm dev
# Visit /settings → pick the new provider → fill fields → Test → Save.
# Visit /create → confirm the new mapping uses the new provider.
# Visit / → confirm Dangling Ports behaves (list unclaimed ports, Release works).
```

Settings hot-reload means no container restart — `PUT /api/settings/vpn` calls `runtime.reloadVpn()` which swaps the live provider instance and restarts the sync watchdog.
