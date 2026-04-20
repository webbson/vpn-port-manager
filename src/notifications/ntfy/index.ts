import type { NotifierDefinition } from "../registry.js";
import { createNtfyNotifier } from "./client.js";
import { describeNtfy, ntfySettingsSchema, type NtfySettings } from "./schema.js";
import { NTFY_READER_NAME, ntfyFields, ntfyReaderScript } from "./view.js";

export const ntfyDefinition: NotifierDefinition<NtfySettings> = {
  id: "ntfy",
  label: "ntfy",
  schema: ntfySettingsSchema,
  create: (settings) => createNtfyNotifier(settings),
  describeStored: describeNtfy,
  renderFields: (stored) => ntfyFields(stored),
  readerName: NTFY_READER_NAME,
  readerScript: ntfyReaderScript,
};

export type { NtfySettings };
