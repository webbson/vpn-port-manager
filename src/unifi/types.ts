export interface DnatRule {
  _id?: string;
  name: string;
  enabled: boolean;
  pfwd_interface: string;
  src: string;
  dst_port: string;
  fwd: string;
  fwd_port: string;
  proto: string;
  log: boolean;
}

export interface FirewallRule {
  _id?: string;
  name: string;
  enabled: boolean;
  ruleset: string;
  rule_index: number;
  action: string;
  protocol: string;
  src_firewallgroup_ids: string[];
  dst_address: string;
  dst_port: string;
  logging: boolean;
}

export interface UnifiClient {
  login(): Promise<void>;
  createDnatRule(rule: Omit<DnatRule, "_id">): Promise<string>;
  updateDnatRule(id: string, rule: Partial<DnatRule>): Promise<void>;
  deleteDnatRule(id: string): Promise<void>;
  getDnatRule(id: string): Promise<DnatRule | null>;
  createFirewallRule(rule: Omit<FirewallRule, "_id">): Promise<string>;
  updateFirewallRule(id: string, rule: Partial<FirewallRule>): Promise<void>;
  deleteFirewallRule(id: string): Promise<void>;
  getFirewallRule(id: string): Promise<FirewallRule | null>;
}
