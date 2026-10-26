import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { promoteStoreOutage } from "@/lib/cms-guard";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

/** HTML z awarią magazynu nie może zostać HTTP 200. Treść strumienia zostaje ta sama. */
const storeOutageMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = result?.response;
  if (!(response instanceof Response)) return result;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return result;
  const promoted = promoteStoreOutage(response.status, response.headers);
  if (!promoted) return result;
  return new Response(response.body, {
    status: promoted.status,
    statusText: response.statusText,
    headers: promoted.headers,
  });
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, storeOutageMiddleware],
}));
