import type { FastifyRequest } from "fastify";
import { OVERLAY_RENDER_COOKIE_OPTIONS } from "@scarline/contracts";

export function overlayRendererCookie(request: Pick<FastifyRequest, "protocol" | "hostname">, rendererId: string) {
  // Safari rejects Secure cookies on HTTP loopback. Keep HTTPS mandatory for
  // non-loopback hosts and keep credentials inaccessible to widget JavaScript.
  const localHttp = request.protocol === "http"
    && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(request.hostname);
  return {
    name: localHttp ? "scarline_overlay_renderer" : "__Secure-scarline_overlay_renderer",
    options: {
      ...OVERLAY_RENDER_COOKIE_OPTIONS,
      secure: !localHttp,
      // Each launch has its own cookie path, so other launches cannot replace
      // its scope and requests do not accumulate every widget's credentials.
      path: `/api/v1/overlay/renderers/${rendererId}`,
    },
  };
}
