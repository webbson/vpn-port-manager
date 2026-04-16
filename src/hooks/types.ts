export interface HookPayload {
  mappingId: string;
  label: string;
  oldPort: number | null;
  newPort: number | null;
  destIp: string;
  destPort: number;
}

export interface HookResult {
  success: boolean;
  error?: string;
}

export interface HookPlugin {
  name: string;
  execute(config: Record<string, any>, payload: HookPayload): Promise<HookResult>;
}
