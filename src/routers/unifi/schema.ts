import { z } from "zod";

export const unifiRouterSchema = z.object({
  type: z.literal("unifi"),
  host: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  inInterfaceId: z.string().min(1),
  sourceZoneId: z.string().min(1),
  destinationZoneId: z.string().min(1),
});
export type UnifiRouterSettings = z.infer<typeof unifiRouterSchema>;

export function describeUnifi(s: UnifiRouterSettings): Record<string, unknown> {
  return {
    type: s.type,
    host: s.host,
    username: s.username,
    inInterfaceId: s.inInterfaceId,
    sourceZoneId: s.sourceZoneId,
    destinationZoneId: s.destinationZoneId,
  };
}
