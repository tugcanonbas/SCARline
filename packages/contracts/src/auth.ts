import { z } from "zod";

import { IsoDateTimeSchema, UuidSchema } from "./common.js";
import { RoleSchema } from "./domain.js";
import { OverlayRuntimeScopeSchema } from "./layout.js";

export const REFRESH_TOKEN_COOKIE_NAME = "__Host-scarline_refresh";
export const OVERLAY_RENDER_COOKIE_NAME = "__Host-scarline_overlay";

export const REFRESH_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
  priority: "high",
} as const;

export const OVERLAY_RENDER_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
  priority: "high",
} as const;

export const LoginRequestSchema = z
  .object({
    username: z.string().min(1).max(100),
    password: z.string().min(1).max(128),
  })
  .strict();

// Enforce password strength when a credential is created or changed. Login
// accepts existing credentials without leaking the current password policy.
export const NewPasswordSchema = z.string().min(12).max(128);

export const AuthenticatedUserSchema = z
  .object({
    id: UuidSchema,
    username: z.string().min(1).max(100),
    displayName: z.string().min(1).max(200),
    passwordResetRequired: z.boolean(),
    roles: z.array(RoleSchema).min(1),
  })
  .strict();

export const AccessTokenClaimsSchema = z
  .object({
    iss: z.literal("scarline-core-api"),
    aud: z.literal("scarline-admin-panel"),
    sub: UuidSchema,
    jti: UuidSchema,
    authSessionId: UuidSchema,
    username: z.string().min(1).max(100),
    displayName: z.string().min(1).max(200),
    roles: z.array(RoleSchema).min(1),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

export const UserWebSocketTicketClaimsSchema = z
  .object({
    iss: z.literal("scarline-core-api"),
    aud: z.literal("scarline-user-websocket"),
    sub: UuidSchema,
    jti: UuidSchema,
    authSessionId: UuidSchema,
    tokenType: z.literal("user-websocket-ticket"),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
  })
  .strict();

export const UserWebSocketTicketResponseSchema = z
  .object({
    token: z.string().min(1),
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

const OverlayTokenClaimsBaseSchema = z.object({
  iss: z.literal("scarline-core-api"),
  sub: z.string().min(1),
  jti: UuidSchema,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  scope: OverlayRuntimeScopeSchema,
});

export const OverlayBootstrapTokenClaimsSchema = OverlayTokenClaimsBaseSchema.extend({
  aud: z.literal("scarline-overlay-bootstrap"),
  tokenType: z.literal("overlay-bootstrap"),
}).strict();

export const OverlayRenderSessionClaimsSchema = OverlayTokenClaimsBaseSchema.extend({
  aud: z.literal("scarline-overlay-renderer"),
  tokenType: z.literal("overlay-render-session"),
}).strict();

export const OverlayWebSocketTicketClaimsSchema = OverlayTokenClaimsBaseSchema.extend({
  aud: z.literal("scarline-overlay-websocket"),
  tokenType: z.literal("overlay-websocket-ticket"),
}).strict();

export const AccessTokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: IsoDateTimeSchema,
    user: AuthenticatedUserSchema,
  })
  .strict();

// Refresh and logout tokens are accepted only through the hardened cookie.
export const EmptyAuthRequestSchema = z.object({}).strict();

export const AuthMutationHeadersSchema = z
  .object({
    origin: z.string().url(),
    "content-type": z.string().regex(/^application\/json(?:;.*)?$/i),
  })
  .passthrough();

export const WebSocketAuthHeadersSchema = z
  .object({
    authorization: z.string().regex(/^Bearer\s+\S+$/i).optional(),
    "sec-websocket-protocol": z.string().min(1).optional(),
  })
  .passthrough()
  .refine(
    (headers) => headers.authorization !== undefined || headers["sec-websocket-protocol"] !== undefined,
    "WebSocket authentication is required",
  );

export const UserWebSocketTicketHeadersSchema = z
  .object({
    "sec-websocket-protocol": z.string().min(1),
  })
  .passthrough();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;
export type UserWebSocketTicketClaims = z.infer<typeof UserWebSocketTicketClaimsSchema>;
export type UserWebSocketTicketResponse = z.infer<typeof UserWebSocketTicketResponseSchema>;
export type OverlayBootstrapTokenClaims = z.infer<typeof OverlayBootstrapTokenClaimsSchema>;
export type OverlayRenderSessionClaims = z.infer<typeof OverlayRenderSessionClaimsSchema>;
export type OverlayWebSocketTicketClaims = z.infer<typeof OverlayWebSocketTicketClaimsSchema>;
export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;
