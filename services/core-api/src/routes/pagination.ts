import { z } from "zod";

import { ApiProblem } from "../errors.js";

export const PaginationQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().optional(),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export interface CursorValue {
  readonly createdAt: string;
  readonly id: string;
}

export function decodeCursor(value: string | undefined): CursorValue | null {
  if (value === undefined) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof decoded.createdAt !== "string" ||
      Number.isNaN(Date.parse(decoded.createdAt)) ||
      typeof decoded.id !== "string" ||
      !z.string().uuid().safeParse(decoded.id).success
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw new ApiProblem(400, "INVALID_CURSOR", "Pagination cursor is invalid.");
  }
}

export function encodeCursor(value: CursorValue | undefined): string | null {
  return value === undefined
    ? null
    : Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
