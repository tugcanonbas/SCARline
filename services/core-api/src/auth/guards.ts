import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@scarline/contracts";
import type { Pool } from "pg";

import { ApiProblem } from "../errors.js";
import type { AuthService, AuthenticatedPrincipal } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    principal?: AuthenticatedPrincipal;
  }
}

export function authenticate(auth: AuthService) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) {
      throw new ApiProblem(401, "AUTHENTICATION_REQUIRED", "Authentication required.");
    }
    request.principal = await auth.authenticate(header.slice(7));
  };
}

export async function requirePasswordReady(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (request.principal?.passwordResetRequired) {
    throw new ApiProblem(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "The password must be changed before using this endpoint.",
    );
  }
}

export function requireAnyRole(...roles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const principal = request.principal;
    if (principal === undefined || !roles.some((role) => principal.roles.includes(role))) {
      throw new ApiProblem(403, "FORBIDDEN", "Insufficient permissions.");
    }
  };
}

export async function requireStudyAccess(
  pool: Pool,
  principal: AuthenticatedPrincipal,
  studyId: string,
): Promise<void> {
  if (principal.roles.includes("admin")) return;
  const result = await pool.query(
    "SELECT 1 FROM study_users WHERE study_id = $1 AND user_id = $2",
    [studyId, principal.id],
  );
  if (result.rowCount !== 1) {
    throw new ApiProblem(403, "STUDY_ACCESS_DENIED", "Study access denied.");
  }
}
