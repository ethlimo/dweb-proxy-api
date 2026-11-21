import type { IAskEndpointConfig } from "dweb-api-types/config";
import type { IRequestContext } from "dweb-api-types/request-context";
import type { IDomainRateLimitService } from "../services/DomainRateLimit/index.js";

// The name a certificate request is counted against besides the hostname
// itself. Whoever owns a name can make any number of names below it, as
// subnames or through a wildcard resolver (ENSIP-10, which can be offchain
// and cost nothing per name), so a limit per hostname doesn't bound how
// many certificates one owner can ask for. Getting another registered name
// does cost something: that's the second level under the tld, or the
// third under base.eth, where Basenames are registered.
export function registeredName(hostname: string): string {
  const labels = hostname.split(".");
  const depth = hostname.endsWith(".base.eth") ? 3 : 2;
  return labels.slice(-depth).join(".");
}

export type AskRateLimitResult =
  | { limited: false }
  | { limited: true; scope: "hostname" | "registered name"; key: string };

// Both limits share ASK_RATE_PERIOD and are only active when the ask rate
// limit is on (ASK_RATE_LIMIT > 0). The hostname limit is checked first, so
// a single hostname that keeps being asked for can't use up the allowance
// of its registered name by more than ASK_RATE_LIMIT per period.
export class AskRateLimiter {
  // separate from the hostname counters, which use the hostname as key
  static readonly REGISTERED_NAME_PREFIX = "ask-registered-name/";

  constructor(
    private readonly config: IAskEndpointConfig,
    private readonly counters: IDomainRateLimitService,
  ) {}

  async check(
    request: IRequestContext,
    hostname: string,
  ): Promise<AskRateLimitResult> {
    const settings = this.config.getConfigAskEndpoint();
    if (!settings.getRateEnabled()) {
      return { limited: false };
    }
    const period = settings.getRatePeriod();

    const perHostname = await this.counters.incrementRateLimit(
      request,
      hostname,
      settings.getRateLimit(),
      period,
    );
    if (perHostname.countOverMax) {
      return { limited: true, scope: "hostname", key: hostname };
    }

    const nameLimit = settings.getRegisteredNameRateLimit?.() ?? 0;
    if (nameLimit > 0) {
      const name = registeredName(hostname);
      const perName = await this.counters.incrementRateLimit(
        request,
        AskRateLimiter.REGISTERED_NAME_PREFIX + name,
        nameLimit,
        period,
      );
      if (perName.countOverMax) {
        return { limited: true, scope: "registered name", key: name };
      }
    }

    return { limited: false };
  }
}
