import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { CoreApiConfig } from './config.js';
import type { Role } from '@scarline/contracts';

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  roles: Role[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(user: AuthenticatedUser, config: CoreApiConfig): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      roles: user.roles,
      displayName: user.displayName
    },
    config.JWT_SECRET,
    {
      expiresIn: '1h'
    }
  );
}

export async function issueRefreshToken(pool: Pool, userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
}

export async function revokeRefreshToken(pool: Pool, refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1
       AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function rotateRefreshToken(pool: Pool, refreshToken: string): Promise<{ refreshToken: string; userId: string } | null> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const result = await pool.query<{ user_id: string }>(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND EXISTS (
         SELECT 1
         FROM users
         WHERE users.id = refresh_tokens.user_id
           AND users.is_active = TRUE
           AND users.password_reset_required = FALSE
       )
     RETURNING user_id`,
    [tokenHash]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return {
    refreshToken: await issueRefreshToken(pool, result.rows[0].user_id),
    userId: result.rows[0].user_id
  };
}

export function verifyAccessToken(token: string, config: CoreApiConfig): jwt.JwtPayload {
  return jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
}
