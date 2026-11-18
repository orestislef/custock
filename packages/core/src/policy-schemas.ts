// the policy shapes the api accepts (see policies.ts for the registry and the rules)
import { z } from './zod';

export const PolicyValueSchema = z.union([z.number(), z.boolean(), z.string().max(40)]);
// a patch of values for one level: a value sets it, null takes it away (back to the level above)
export const PolicyPatch = z.record(z.string().max(60), PolicyValueSchema.nullable());
export type PolicyPatch = z.infer<typeof PolicyPatch>;

export const BusinessPolicyControlsPatch = z.record(
  z.string().max(60),
  z.object({ limit: PolicyValueSchema.nullable().optional(), delegated: z.boolean().optional() }),
);
export type BusinessPolicyControlsPatch = z.infer<typeof BusinessPolicyControlsPatch>;
