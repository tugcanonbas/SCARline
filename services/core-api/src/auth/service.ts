import { createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  AccessTokenClaimsSchema,
  OverlayBootstrapTokenClaimsSchema,
  OverlayRenderSessionClaimsSchema,
  OverlayWebSocketTicketClaimsSchema,
  UserWebSocketTicketClaimsSchema,
  type AccessTokenClaims,
  type AuthenticatedUser,
  type OverlayRuntimeScope,
  type Role,
} from "@scarline/contracts";
import { jwtVerify, SignJWT } from "jose";
import type { Pool, PoolClient } from "pg";

import type { CoreApiConfig } from "../config.js";
import { ApiProblem } from "../errors.js";
import { hashPassword, verifyPassword } from "../security/password.js";

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  is_active: boolean;
  password_reset_required: boolean;
  roles: Role[];
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface AuthenticatedPrincipal extends AuthenticatedUser {
  readonly authSessionId: string;
  readonly passwordResetRequired: boolean;
}

export interface IssuedAuthentication {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly user: AuthenticatedUser;
}

export class AuthService {
  readonly #pool: Pool;
  readonly #config: CoreApiConfig;
  readonly #jwtKey: Uint8Array;

  constructor(pool: Pool, config: CoreApiConfig) {
    this.#pool = pool;
    this.#config = config;
    this.#jwtKey = new TextEncoder().encode(config.secrets.JWT_ACCESS_SECRET);
  }

  async login(
    username: string,
    password: string,
    userAgent: string | undefined,
    ipAddress: string,
  ): Promise<IssuedAuthentication> {
    const result = await this.#pool.query<UserRow>(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_active,
              u.password_reset_required,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE lower(u.username) = lower($1)
       GROUP BY u.id`,
      [username],
    );
    const user = result.rows[0];
    if (
      user === undefined ||
      !user.is_active ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      throw new ApiProblem(401, "INVALID_CREDENTIALS", "Invalid username or password.");
    }

    const refreshToken = this.#newRefreshToken();
    const session = await this.#pool.query<{ id: string }>(
      `INSERT INTO auth_sessions
         (user_id, refresh_token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'), $4, $5::inet)
       RETURNING id`,
      [
        user.id,
        this.#hashRefreshToken(refreshToken),
        this.#config.project.api.refresh_token_ttl_days,
        userAgent ?? null,
        ipAddress,
      ],
    );
    await this.#pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [
      user.id,
    ]);
    return this.#issueAuthentication(user, session.rows[0]!.id, refreshToken);
  }

  async refresh(refreshToken: string): Promise<IssuedAuthentication> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const tokenHash = this.#hashRefreshToken(refreshToken);
      const sessionResult = await client.query<AuthSessionRow>(
        `SELECT id, user_id, expires_at, revoked_at
         FROM auth_sessions
         WHERE refresh_token_hash = $1
         FOR UPDATE`,
        [tokenHash],
      );
      const session = sessionResult.rows[0];
      if (session === undefined) {
        const replay = await client.query<{ auth_session_id: string }>(
          `SELECT auth_session_id
           FROM auth_refresh_token_history
           WHERE token_hash = $1`,
          [tokenHash],
        );
        if (replay.rows[0] !== undefined) {
          await client.query(
            "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = $1",
            [replay.rows[0].auth_session_id],
          );
          await client.query("COMMIT");
          throw new ApiProblem(
            401,
            "REFRESH_TOKEN_REPLAY",
            "The authentication session was revoked.",
          );
        }
        throw new ApiProblem(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token.");
      }
      if (session.revoked_at !== null || session.expires_at.getTime() <= Date.now()) {
        throw new ApiProblem(401, "EXPIRED_REFRESH_TOKEN", "Refresh token expired.");
      }

      const user = await this.#loadUser(client, session.user_id);
      if (!user.is_active) {
        throw new ApiProblem(401, "USER_DISABLED", "The user account is disabled.");
      }

      const nextRefreshToken = this.#newRefreshToken();
      await client.query(
        `INSERT INTO auth_refresh_token_history (token_hash, auth_session_id)
         VALUES ($1, $2)`,
        [tokenHash, session.id],
      );
      await client.query(
        `UPDATE auth_sessions
         SET refresh_token_hash = $2, last_used_at = NOW()
         WHERE id = $1`,
        [session.id, this.#hashRefreshToken(nextRefreshToken)],
      );
      await client.query("COMMIT");
      return await this.#issueAuthentication(user, session.id, nextRefreshToken);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined) return;
    const tokenHash = this.#hashRefreshToken(refreshToken);
    await this.#pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE refresh_token_hash = $1
          OR id IN (
            SELECT auth_session_id FROM auth_refresh_token_history WHERE token_hash = $1
          )`,
      [tokenHash],
    );
  }

  async authenticate(accessToken: string): Promise<AuthenticatedPrincipal> {
    let claims: AccessTokenClaims;
    try {
      const verified = await jwtVerify(accessToken, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-admin-panel",
      });
      claims = AccessTokenClaimsSchema.parse(verified.payload);
    } catch {
      throw new ApiProblem(401, "INVALID_ACCESS_TOKEN", "Invalid access token.");
    }

    return this.#loadPrincipal(claims.sub, claims.authSessionId);
  }

  async signUserWebSocketTicket(
    principal: AuthenticatedPrincipal,
  ): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + 30_000);
    const jti = randomUUID();
    await this.#pool.query(
      `INSERT INTO auth_websocket_tickets(jti,auth_session_id,expires_at)
       VALUES($1,$2,$3)`,
      [jti, principal.authSessionId, expiresAt],
    );
    void this.#pool.query(
      "DELETE FROM auth_websocket_tickets WHERE expires_at < NOW() - INTERVAL '1 day'",
    ).catch(() => undefined);
    const token = await new SignJWT({
      tokenType: "user-websocket-ticket",
      authSessionId: principal.authSessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-user-websocket")
      .setSubject(principal.id)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async verifyUserWebSocketTicket(token: string): Promise<AuthenticatedPrincipal> {
    let claims;
    try {
      const verified = await jwtVerify(token, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-user-websocket",
      });
      claims = UserWebSocketTicketClaimsSchema.parse(verified.payload);
    } catch {
      throw new ApiProblem(401, "INVALID_WEBSOCKET_TICKET", "Invalid WebSocket ticket.");
    }
    const consumed = await this.#pool.query(
      `UPDATE auth_websocket_tickets SET consumed_at=NOW()
       WHERE jti=$1 AND auth_session_id=$2 AND consumed_at IS NULL AND expires_at>NOW()
       RETURNING jti`,
      [claims.jti, claims.authSessionId],
    );
    if (consumed.rowCount !== 1) {
      throw new ApiProblem(401, "INVALID_WEBSOCKET_TICKET", "Invalid or reused WebSocket ticket.");
    }
    return this.#loadPrincipal(claims.sub, claims.authSessionId);
  }

  async #loadPrincipal(userId: string, authSessionId: string): Promise<AuthenticatedPrincipal> {
    const result = await this.#pool.query<{
      id: string;
      username: string;
      display_name: string;
      is_active: boolean;
      password_reset_required: boolean;
      revoked_at: Date | null;
      expires_at: Date;
      roles: Role[];
    }>(
      `SELECT u.id, u.username, u.display_name, u.is_active,
              u.password_reset_required, s.revoked_at, s.expires_at,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE s.id = $1 AND u.id = $2
       GROUP BY u.id, s.id`,
      [authSessionId, userId],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      !row.is_active ||
      row.revoked_at !== null ||
      row.expires_at.getTime() <= Date.now()
    ) {
      throw new ApiProblem(401, "AUTH_SESSION_REVOKED", "Authentication expired.");
    }
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roles: row.roles,
      authSessionId,
      passwordResetRequired: row.password_reset_required,
    };
  }

  async changePassword(
    principal: AuthenticatedPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const result = await this.#pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [principal.id],
    );
    if (
      result.rows[0] === undefined ||
      !(await verifyPassword(currentPassword, result.rows[0].password_hash))
    ) {
      throw new ApiProblem(400, "INVALID_CURRENT_PASSWORD", "Current password is invalid.");
    }
    const passwordHash = await hashPassword(newPassword);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users
         SET password_hash = $2, password_reset_required = FALSE
         WHERE id = $1`,
        [principal.id, passwordHash],
      );
      await client.query(
        "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1",
        [principal.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createPasswordHash(password: string): Promise<string> {
    return hashPassword(password);
  }

  async signOverlayToken(): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(
      Date.now() + this.#config.project.api.overlay_token_ttl_minutes * 60_000,
    );
    const token = await new SignJWT({ service: "desktop-overlay" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-desktop-overlay")
      .setSubject("desktop-overlay")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async verifyOverlayToken(token: string): Promise<void> {
    try {
      await jwtVerify(token, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-desktop-overlay",
        subject: "desktop-overlay",
      });
    } catch {
      throw new ApiProblem(401, "INVALID_OVERLAY_TOKEN", "Invalid overlay token.");
    }
  }

  async signOverlayBootstrapToken(
    scope: OverlayRuntimeScope,
  ): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(
      Date.now() + this.#config.project.api.overlay_token_ttl_minutes * 60_000,
    );
    const jti = randomUUID();
    await this.#recordOverlayCredential(jti, "bootstrap", expiresAt);
    const token = await new SignJWT({
      tokenType: "overlay-bootstrap",
      scope,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-overlay-bootstrap")
      .setSubject(scope.instanceId ?? scope.layoutId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async exchangeOverlayBootstrapToken(
    token: string,
  ): Promise<{ token: string; expiresAt: string; scope: OverlayRuntimeScope }> {
    let claims;
    try {
      const verified = await jwtVerify(token, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-overlay-bootstrap",
      });
      claims = OverlayBootstrapTokenClaimsSchema.parse(verified.payload);
    } catch {
      throw new ApiProblem(401, "INVALID_OVERLAY_BOOTSTRAP", "Invalid overlay bootstrap credential.");
    }
    if (!(await this.#consumeOverlayCredential(claims.jti, "bootstrap"))) {
      throw new ApiProblem(401, "OVERLAY_BOOTSTRAP_REUSED", "Overlay bootstrap credential was already used.");
    }

    const expiresAt = new Date(
      Date.now()
        + this.#config.project.api.overlay_renderer_session_ttl_hours * 3_600_000,
    );
    const sessionToken = await new SignJWT({
      tokenType: "overlay-render-session",
      scope: claims.scope,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-overlay-renderer")
      .setSubject(claims.sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return {
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
      scope: claims.scope,
    };
  }

  async verifyOverlayRenderSession(token: string): Promise<OverlayRuntimeScope> {
    try {
      const verified = await jwtVerify(token, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-overlay-renderer",
      });
      return OverlayRenderSessionClaimsSchema.parse(verified.payload).scope;
    } catch {
      throw new ApiProblem(401, "INVALID_OVERLAY_SESSION", "Invalid overlay renderer session.");
    }
  }

  async signOverlayWebSocketTicket(
    scope: OverlayRuntimeScope,
  ): Promise<{ token: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + 60_000);
    const jti = randomUUID();
    await this.#recordOverlayCredential(jti, "websocket_ticket", expiresAt);
    const token = await new SignJWT({
      tokenType: "overlay-websocket-ticket",
      scope,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-overlay-websocket")
      .setSubject(scope.instanceId ?? scope.layoutId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async verifyOverlayWebSocketTicket(token: string): Promise<OverlayRuntimeScope> {
    try {
      const verified = await jwtVerify(token, this.#jwtKey, {
        issuer: "scarline-core-api",
        audience: "scarline-overlay-websocket",
      });
      const claims = OverlayWebSocketTicketClaimsSchema.parse(verified.payload);
      if (!(await this.#consumeOverlayCredential(claims.jti, "websocket_ticket"))) {
        throw new Error("Overlay WebSocket ticket was already used.");
      }
      return claims.scope;
    } catch {
      throw new ApiProblem(401, "INVALID_OVERLAY_TICKET", "Invalid overlay WebSocket ticket.");
    }
  }

  async #recordOverlayCredential(
    jti: string,
    kind: "bootstrap" | "websocket_ticket",
    expiresAt: Date,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO overlay_credentials(jti,kind,expires_at) VALUES($1,$2,$3)`,
      [jti, kind, expiresAt],
    );
    void this.#pool.query("DELETE FROM overlay_credentials WHERE expires_at < NOW() - INTERVAL '1 day'")
      .catch(() => undefined);
  }

  async #consumeOverlayCredential(
    jti: string,
    kind: "bootstrap" | "websocket_ticket",
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE overlay_credentials SET consumed_at=NOW()
        WHERE jti=$1 AND kind=$2 AND consumed_at IS NULL AND expires_at>NOW()
        RETURNING jti`,
      [jti, kind],
    );
    return result.rowCount === 1;
  }

  #newRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  #hashRefreshToken(token: string): string {
    return createHmac("sha256", this.#config.secrets.REFRESH_TOKEN_PEPPER)
      .update(token)
      .digest("hex");
  }

  async #loadUser(client: PoolClient, userId: string): Promise<UserRow> {
    const result = await client.query<UserRow>(
      `SELECT u.id, u.username, u.password_hash, u.display_name, u.is_active,
              u.password_reset_required,
              COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [userId],
    );
    const user = result.rows[0];
    if (user === undefined) {
      throw new ApiProblem(401, "USER_NOT_FOUND", "The user no longer exists.");
    }
    return user;
  }

  async #issueAuthentication(
    user: UserRow,
    authSessionId: string,
    refreshToken: string,
  ): Promise<IssuedAuthentication> {
    const expiresAt = new Date(
      Date.now() + this.#config.project.api.access_token_ttl_minutes * 60_000,
    );
    const accessToken = await new SignJWT({
      authSessionId,
      username: user.username,
      displayName: user.display_name,
      roles: user.roles,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("scarline-core-api")
      .setAudience("scarline-admin-panel")
      .setSubject(user.id)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1_000))
      .sign(this.#jwtKey);
    return {
      accessToken,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        passwordResetRequired: user.password_reset_required,
        roles: user.roles,
      },
    };
  }
}
