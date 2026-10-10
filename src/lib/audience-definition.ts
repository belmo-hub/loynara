import { z } from "zod";

const days = z.number().int().min(1).max(3650);
export const audienceDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("new"), withinDays: days }).strict(),
  z.object({ kind: z.literal("recently_active"), withinDays: days }).strict(),
  z.object({ kind: z.literal("inactive"), daysSinceLast: days }).strict(),
  z.object({ kind: z.literal("frequent_visitors"), withinDays: days, minCheckouts: z.number().int().min(1).max(10000) }).strict(),
  z.object({ kind: z.literal("close_to_reward"), maxRemaining: z.number().int().min(1).max(100000), rewardId: z.uuid().optional() }).strict(),
]);

export type AudienceDefinition = z.infer<typeof audienceDefinitionSchema>;

