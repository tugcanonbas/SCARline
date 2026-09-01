import type { FastifyInstance } from "fastify";

import { authenticate, requireAnyRole, requirePasswordReady } from "../auth/guards.js";
import type { AuthService } from "../auth/service.js";
import { ApiProblem } from "../errors.js";
import { SensorCatalogueService, SensorCatalogueValidationError } from "../sensors/catalogue.js";
import { AuthHeadersSchema, EmptyObjectSchema, success } from "./common.js";

export async function registerSensorRoutes(app: FastifyInstance, auth: AuthService, catalogue: SensorCatalogueService): Promise<void> {
  const read = [authenticate(auth), requirePasswordReady];
  const refresh = [...read, requireAnyRole("admin", "researcher")];
  app.get("/api/v1/sensors/catalogue", { preHandler: read, schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema } }, async () => success(await catalogue.list()));
  app.post("/api/v1/sensors/refresh", { preHandler: refresh, schema: { params: EmptyObjectSchema, querystring: EmptyObjectSchema, headers: AuthHeadersSchema, body: EmptyObjectSchema } }, async (request) => {
    try { return success(await catalogue.refresh(request.principal!.id)); }
    catch (error) {
      if (error instanceof SensorCatalogueValidationError) throw new ApiProblem(409, "SENSOR_CATALOGUE_INVALID", error.message, { issues: error.issues });
      throw error;
    }
  });
}
