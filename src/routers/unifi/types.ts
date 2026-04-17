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
