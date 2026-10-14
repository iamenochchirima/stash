import type { FastifyRequest } from "fastify";
// Match the registered route, so encoded aliases cannot bypass namespace guards.
export function requestPath(request: FastifyRequest) {
  const pattern=request.routeOptions?.url;
  return pattern && pattern !== "/*" ? pattern : request.url.split("?")[0];
}
