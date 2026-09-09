import { z } from "zod";

export const SessionStatusSchema = z.enum([
  "created",
  "ready",
  "running",
  "paused",
  "completed",
  "aborted",
  "failed",
]);

export const SessionTransitionSchema = z.discriminatedUnion("from", [
  z.object({
    from: z.literal("created"),
    to: z.enum(["ready", "aborted", "failed"]),
  }),
  z.object({
    from: z.literal("ready"),
    to: z.enum(["running", "aborted", "failed"]),
  }),
  z.object({
    from: z.literal("running"),
    to: z.enum(["paused", "completed", "aborted", "failed"]),
  }),
  z.object({
    from: z.literal("paused"),
    to: z.enum(["running", "completed", "aborted", "failed"]),
  }),
]);

export const TerminalSessionStatusSchema = z.enum([
  "completed",
  "aborted",
  "failed",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionTransition = z.infer<typeof SessionTransitionSchema>;
export type TerminalSessionStatus = z.infer<
  typeof TerminalSessionStatusSchema
>;

export function canTransitionSession(
  from: SessionStatus,
  to: SessionStatus,
): boolean {
  return SessionTransitionSchema.safeParse({ from, to }).success;
}
