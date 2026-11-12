import type { Express, NextFunction, Request, Response } from "express";
import type { IClientRateLimitConfig } from "dweb-api-types/config";
import type { ILoggerService } from "dweb-api-types/logger";
import type { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { getTraceIdFromRequest } from "../utils/index.js";

// TRUST_PROXY is passed to express as "trust proxy". Without it req.ip is
// the address of whatever connects to us, which behind Caddy is Caddy
// itself, so every client would share one counter.
// Accepts "true", a hop count, or a comma separated list of addresses /
// subnets / express presets like "loopback".
export function applyTrustProxy(app: Express, value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "false") {
    return;
  }
  if (trimmed === "true") {
    app.set("trust proxy", true);
  } else if (/^\d+$/.test(trimmed)) {
    app.set("trust proxy", Number(trimmed));
  } else {
    app.set(
      "trust proxy",
      trimmed.split(",").map((s) => s.trim()),
    );
  }
}

export function clientRateLimit(
  config: IClientRateLimitConfig,
  rateLimitService: IDomainRateLimitService,
  logger: ILoggerService,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const settings = config.getClientRateLimitConfig();
    const limit = settings.getLimit();
    const ip = req.ip;
    if (!(limit > 0) || !ip) {
      next();
      return;
    }

    const request = { trace_id: getTraceIdFromRequest(req) };
    try {
      const result = await rateLimitService.incrementRateLimit(
        request,
        `client/${ip}`,
        limit,
        settings.getPeriod(),
      );
      if (result.countOverMax) {
        logger.info("client rate limited", {
          ...request,
          origin: "clientRateLimit",
          context: { ip, count: result.count },
        });
        res.writeHead(429, { "Retry-After": String(Math.max(result.ttl, 1)) });
        res.end();
        return;
      }
    } catch (e) {
      // if redis is down we'd rather serve requests than reject all of them
      logger.error("client rate limit check failed, letting request through", {
        ...request,
        origin: "clientRateLimit",
        context: { ip, error: e },
      });
    }
    next();
  };
}
