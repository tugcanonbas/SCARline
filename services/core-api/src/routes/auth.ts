import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  AccessTokenResponseSchema,
  AuthMutationHeadersSchema,
  EmptyAuthRequestSchema,
  LoginRequestSchema,
  NewPasswordSchema,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_OPTIONS,
  UserWebSocketTicketResponseSchema,
} from "@scarline/contracts";

import type { CoreApiConfig } from "../config.js";
import { ApiProblem } from "../errors.js";
import { authenticate, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { AuthHeadersSchema, EmptyObjectSchema, PublicHeadersSchema, success } from "./common.js";

const ChangePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: NewPasswordSchema })
  .strict();

function assertOrigin(origin: string | undefined, config: CoreApiConfig): void {
  if (origin === undefined || !config.project.api.allowed_origins.includes(origin)) {
    throw new ApiProblem(403, "ORIGIN_DENIED", "Request origin is not allowed.");
  }
}

function setRefreshCookie(
  reply: FastifyReply,
  refreshToken: string,
  config: CoreApiConfig,
): void {
  reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    ...REFRESH_TOKEN_COOKIE_OPTIONS,
    maxAge: config.project.api.refresh_token_ttl_days * 86_400,
  });
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  config: CoreApiConfig,
): Promise<void> {
  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: AuthMutationHeadersSchema,
        body: LoginRequestSchema,
      },
    },
    async (request, reply) => {
      assertOrigin(request.headers.origin, config);
      const body = LoginRequestSchema.parse(request.body);
      const issued = await auth.login(
        body.username,
        body.password,
        request.headers["user-agent"],
        request.ip,
      );
      setRefreshCookie(reply, issued.refreshToken, config);
      return success(AccessTokenResponseSchema.parse({
        accessToken: issued.accessToken,
        accessTokenExpiresAt: issued.accessTokenExpiresAt,
        user: issued.user,
      }));
    },
  );

  app.post(
    "/api/v1/auth/refresh",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: AuthMutationHeadersSchema,
        body: EmptyAuthRequestSchema,
      },
    },
    async (request, reply) => {
      assertOrigin(request.headers.origin, config);
      const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE_NAME];
      if (refreshToken === undefined) {
        throw new ApiProblem(401, "REFRESH_TOKEN_REQUIRED", "Refresh token required.");
      }
      const issued = await auth.refresh(refreshToken);
      setRefreshCookie(reply, issued.refreshToken, config);
      return success(AccessTokenResponseSchema.parse({
        accessToken: issued.accessToken,
        accessTokenExpiresAt: issued.accessTokenExpiresAt,
        user: issued.user,
      }));
    },
  );

  app.post(
    "/api/v1/auth/logout",
    {
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: AuthMutationHeadersSchema,
        body: EmptyAuthRequestSchema,
      },
    },
    async (request, reply) => {
      assertOrigin(request.headers.origin, config);
      await auth.logout(request.cookies[REFRESH_TOKEN_COOKIE_NAME]);
      reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS);
      return reply.status(204).send();
    },
  );

  app.get(
    "/api/v1/auth/me",
    {
      preHandler: [authenticate(auth)],
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: PublicHeadersSchema,
      },
    },
    async (request) => success(request.principal),
  );

  app.post(
    "/api/v1/auth/websocket-ticket",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preHandler: [authenticate(auth), requirePasswordReady],
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: AuthHeadersSchema,
        body: EmptyAuthRequestSchema,
      },
    },
    async (request) => success(UserWebSocketTicketResponseSchema.parse(
      await auth.signUserWebSocketTicket(request.principal!),
    )),
  );

  app.post(
    "/api/v1/auth/change-password",
    {
      preHandler: [authenticate(auth)],
      schema: {
        params: EmptyObjectSchema,
        querystring: EmptyObjectSchema,
        headers: AuthMutationHeadersSchema,
        body: ChangePasswordSchema,
      },
    },
    async (request, reply) => {
      assertOrigin(request.headers.origin, config);
      const body = ChangePasswordSchema.parse(request.body);
      await auth.changePassword(
        request.principal!,
        body.currentPassword,
        body.newPassword,
      );
      reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_OPTIONS);
      return reply.status(204).send();
    },
  );
}
