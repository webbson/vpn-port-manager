export interface ProviderPort {
  port: number;
  expiresAt: number;
}

export interface VpnProvider {
  name: string;
  maxPorts: number;
  listPorts(): Promise<ProviderPort[]>;
  createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort>;
  deletePort(port: number): Promise<void>;
  checkPort(port: number): Promise<boolean>;
}
