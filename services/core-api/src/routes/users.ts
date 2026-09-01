import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { NewPasswordSchema, RoleSchema } from "@scarline/contracts";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { recordActivity } from "../infrastructure/activity.js";
import { AuthHeadersSchema, EmptyObjectSchema, UuidParamsSchema, success } from "./common.js";
import { PaginationQuerySchema, decodeCursor, encodeCursor } from "./pagination.js";

const UserInputSchema = z
  .object({
    username: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/),
    password: NewPasswordSchema,
    displayName: z.string().trim().min(1).max(200),
    email: z.string().email().nullable().default(null),
    institution: z.string().trim().max(300).nullable().default(null),
    roles: z.array(RoleSchema).min(1),
  })
  .strict();
const UserPatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().nullable().optional(),
    institution: z.string().trim().max(300).nullable().optional(),
    roles: z.array(RoleSchema).min(1).optional(),
    isActive: z.boolean().optional(),
    disabledReason: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
const ResetPasswordSchema = z.object({ temporaryPassword: NewPasswordSchema }).strict();

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  institution: string | null;
  is_active: boolean;
  disabled_reason: string | null;
  last_login_at: Date | null;
  password_reset_required: boolean;
  roles: string[];
  created_at: Date;
  updated_at: Date;
}

function mapUser(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    institution: row.institution,
    isActive: row.is_active,
    disabledReason: row.disabled_reason,
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    passwordResetRequired: row.password_reset_required,
    roles: row.roles,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const USER_SELECT = `
  SELECT u.id, u.username, u.display_name, u.email, u.institution, u.is_active,
         u.disabled_reason, u.last_login_at, u.password_reset_required,
         u.created_at, u.updated_at,
         COALESCE(array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id`;

async function assignRoles(client: PoolClient, userId: string, roles: string[]): Promise<void> {
  await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  const result = await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = ANY($2::text[])`,
    [userId, roles],
  );
  if (result.rowCount !== roles.length) {
    throw new ApiProblem(400, "INVALID_ROLES", "One or more roles are invalid.");
  }
}

export async function registerUserRoutes(
  app: FastifyInstance,
  pool: Pool,
  auth: AuthService,
  defaultLimit: number,
  maxLimit: number,
): Promise<void> {
  const adminHandlers = [authenticate(auth), requirePasswordReady, requireAnyRole("admin")];

  app.get("/api/v1/users", {
    preHandler: adminHandlers,
    schema: { params: EmptyObjectSchema, querystring: PaginationQuerySchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const query = PaginationQuerySchema.parse(request.query);
    const limit = Math.min(query.limit ?? defaultLimit, maxLimit);
    const cursor = decodeCursor(query.cursor);
    const result = await pool.query<UserRow>(
      `${USER_SELECT}
       WHERE ($1::timestamptz IS NULL OR (u.created_at, u.id) < ($1, $2::uuid))
       GROUP BY u.id
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $3`,
      [cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const last = hasMore ? rows.at(-1) : undefined;
    return success({
      items: rows.map(mapUser),
      nextCursor: encodeCursor(last === undefined ? undefined : { createdAt: last.created_at.toISOString(), id: last.id }),
    });
  });

  app.post("/api/v1/users", {
    preHandler: adminHandlers,
    schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: UserInputSchema },
  }, async (request, reply) => {
    const body = UserInputSchema.parse(request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users
           (username, password_hash, display_name, email, institution, password_reset_required)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id`,
        [body.username, await auth.createPasswordHash(body.password), body.displayName, body.email, body.institution],
      );
      const id = inserted.rows[0]!.id;
      await assignRoles(client, id, body.roles);
      await recordActivity(client, { actorUserId: request.principal!.id, entityType: "user", entityId: id, action: "user.created", payload: { roles: body.roles } });
      await client.query("COMMIT");
      const created = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
      return reply.status(201).send(success(mapUser(created.rows[0]!)));
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  });

  app.get("/api/v1/users/:id", {
    preHandler: adminHandlers,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const result = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
    if (result.rows[0] === undefined) throw new ApiProblem(404, "USER_NOT_FOUND", "User not found.");
    return success(mapUser(result.rows[0]));
  });

  app.patch("/api/v1/users/:id", {
    preHandler: adminHandlers,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: UserPatchSchema },
  }, async (request) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const body = UserPatchSchema.parse(request.body);
    if (body.isActive === false && !body.disabledReason) {
      throw new ApiProblem(400, "DISABLED_REASON_REQUIRED", "A disabled user requires a reason.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE users SET
           display_name = COALESCE($2, display_name),
           email = CASE WHEN $3 THEN $4 ELSE email END,
           institution = CASE WHEN $5 THEN $6 ELSE institution END,
           is_active = COALESCE($7, is_active),
           disabled_reason = CASE WHEN $7 = TRUE THEN NULL WHEN $7 = FALSE THEN $8 ELSE disabled_reason END
         WHERE id = $1`,
        [id, body.displayName ?? null, "email" in body, body.email ?? null, "institution" in body, body.institution ?? null, body.isActive ?? null, body.disabledReason ?? null],
      );
      if (updated.rowCount !== 1) throw new ApiProblem(404, "USER_NOT_FOUND", "User not found.");
      if (body.roles !== undefined) await assignRoles(client, id, body.roles);
      if (body.isActive === false) {
        await client.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1", [id]);
      }
      await recordActivity(client, { actorUserId: request.principal!.id, entityType: "user", entityId: id, action: "user.updated", payload: { fields: Object.keys(body) } });
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
    const result = await pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`, [id]);
    return success(mapUser(result.rows[0]!));
  });

  app.post("/api/v1/users/:id/reset-password", {
    preHandler: adminHandlers,
    schema: { params: UuidParamsSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: ResetPasswordSchema },
  }, async (request, reply) => {
    const { id } = UuidParamsSchema.parse(request.params);
    const { temporaryPassword } = ResetPasswordSchema.parse(request.body);
    const result = await pool.query(
      `UPDATE users SET password_hash = $2, password_reset_required = TRUE WHERE id = $1`,
      [id, await auth.createPasswordHash(temporaryPassword)],
    );
    if (result.rowCount !== 1) throw new ApiProblem(404, "USER_NOT_FOUND", "User not found.");
    await pool.query("UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1", [id]);
    await recordActivity(pool, { actorUserId: request.principal!.id, entityType: "user", entityId: id, action: "user.password-reset" });
    return reply.status(204).send();
  });
}
