import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import type { ApiErrorEnvelope } from "@scarline/contracts";

export class ApiProblem extends Error {
  readonly statusCode: number;
  readonly problemCode: string;
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: number,
    problemCode: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiProblem";
    this.statusCode = statusCode;
    this.problemCode = problemCode;
    this.details = details;
  }
}

function envelope(
  request: FastifyRequest,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ApiErrorEnvelope {
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
      details,
      requestId: request.id,
    },
  };
}

function classifyError(error: unknown): {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
} {
  if (error instanceof ApiProblem) {
    return {
      statusCode: error.statusCode,
      code: error.problemCode,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: { issues: error.issues },
    };
  }
  const candidate = error as Partial<FastifyError> & { code?: string };
  if (candidate.validation !== undefined) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: { issues: candidate.validation },
    };
  }

  const databaseCode = candidate.code;
  if (databaseCode === "23505") {
    return { statusCode: 409, code: "CONFLICT", message: "The resource exists." };
  }
  if (databaseCode === "23503") {
    return {
      statusCode: 409,
      code: "RESOURCE_IN_USE",
      message: "The resource is still in use.",
    };
  }

  if (
    candidate.statusCode !== undefined &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 500
  ) {
    return {
      statusCode: candidate.statusCode,
      code: candidate.statusCode === 404 ? "NOT_FOUND" : "REQUEST_ERROR",
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "The request could not be processed.",
    };
  }

  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "An internal error occurred.",
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(envelope(request, "NOT_FOUND", "The requested route does not exist."));
  });

  app.setErrorHandler((error, request, reply) => {
    const classified = classifyError(error);
    if (classified.statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    }
    void reply
      .status(classified.statusCode)
      .send(
        envelope(
          request,
          classified.code,
          classified.message,
          classified.details,
        ),
      );
  });
}
