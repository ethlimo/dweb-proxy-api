import type { Express, NextFunction, Request, Response } from "express";
import type { IClientRateLimitConfig } from "dweb-api-types/config";
import type { ILoggerService } from "dweb-api-types/logger";
import type { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";
import { isIP } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { getTraceIdFromRequest } from "../utils/index.js";

// without this, behind caddy req.ip is caddy's own address and every client
// shares one counter. value: "true", hop count, or comma separated
// addresses/subnets/"loopback"
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

// "2001:db8::1" -> ["2001", "db8", "0", "0", "0", "0", "0", "1"]
function ipv6Groups(ip: string): string[] {
  let address = ip.split("%")[0].toLowerCase();
  // ::ffff:1.2.3.4 and 64:ff9b::1.2.3.4 end in an ipv4, that's two groups
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    address =
      address.slice(0, v4.index) +
      ((a << 8) | b).toString(16) +
      ":" +
      ((c << 8) | d).toString(16);
  }
  const [head, tail] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const zeros =
    tail === undefined ? [] : Array(8 - front.length - back.length).fill("0");
  return [...front, ...zeros, ...back].map((g) => parseInt(g, 16).toString(16));
}

// ipv6 clients usually have a whole /64 and could just rotate addresses,
// so they're counted per /64
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) {
    return mapped[1];
  }
  if (isIP(ip.split("%")[0]) !== 6) {
    return ip;
  }
  return `${ipv6Groups(ip).slice(0, 4).join(":")}::/64`;
}

// we don't store client ips, so redis (and the debug log of the key) only
// sees an hmac of it. no CLIENT_RATE_LIMIT_SECRET = random key per process,
// ok for one worker, but several workers need the same secret to share counters
const processSecret = randomBytes(32);

export function hashedClientKey(ip: string, secret?: string): string {
  return createHmac("sha256", secret || processSecret)
    .update(clientKey(ip))
    .digest("hex")
    .slice(0, 32);
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
        `client/${hashedClientKey(ip, settings.getSecret())}`,
        limit,
        settings.getPeriod(),
      );
      if (result.countOverMax) {
        logger.info("client rate limited", {
          ...request,
          origin: "clientRateLimit",
          context: { count: result.count },
        });
        res.writeHead(429, { "Retry-After": String(Math.max(result.ttl, 1)) });
        res.end();
        return;
      }
    } catch (e) {
      // redis down -> let traffic through instead of 429ing everyone
      logger.error("client rate limit check failed, letting request through", {
        ...request,
        origin: "clientRateLimit",
        context: { error: e },
      });
    }
    next();
  };
}
