import { expect } from "chai";
import { describe, it } from "mocha";
import { SinonStubbedInstance, createStubInstance } from "sinon";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { IRedisClient } from "dweb-api-types/dist/redis.js";
import { ILoggerService } from "dweb-api-types/dist/logger.js";
import { RedisClient } from "dweb-api-cache/dist/index.js";
import { DomainRateLimitService } from ".";
import { LoggerService } from "dweb-api-logger/dist/index.js";

describe("DomainRateLimitService", () => {
  let redisClient: SinonStubbedInstance<IRedisClient>;
  let logger: ILoggerService;
  let service: DomainRateLimitService;

  beforeEach(() => {
    redisClient = createStubInstance<IRedisClient>(RedisClient);
    logger = createStubInstance<ILoggerService>(LoggerService);
    service = new DomainRateLimitService(redisClient as any, logger as any);
  });

  it("should increment rate limit and set TTL if not already set", async () => {
    const domain = "test.com";
    const maxQueries = 10;
    const intervalInSeconds = 60;

    redisClient.incr.resolves(1);
    redisClient.ttl.resolves(-1);

    const request: IRequestContext = {
      trace_id: "TEST_TRACE_ID",
    };

    const result = await service.incrementRateLimit(
      request,
      domain,
      maxQueries,
      intervalInSeconds,
    );

    expect(result.countOverMax).to.be.false;
    expect(result.count).to.equal(1);
    expect(result.ttl).to.equal(intervalInSeconds);
    expect(
      redisClient.expire.calledOnceWith(
        `rate_limit/${domain}`,
        intervalInSeconds,
      ),
    ).to.be.true;
  });

  it("should increment rate limit and not modify TTL if already set", async () => {
    const domain = "test.com";
    const maxQueries = 10;
    const intervalInSeconds = 60;

    const request: IRequestContext = {
      trace_id: "TEST_TRACE_ID",
    };

    redisClient.incr.resolves(2);
    redisClient.ttl.resolves(30);

    const result = await service.incrementRateLimit(
      request,
      domain,
      maxQueries,
      intervalInSeconds,
    );
    expect(result.countOverMax).to.be.false;
    expect(result.count).to.equal(2);
    expect(result.ttl).to.equal(30);
    expect(redisClient.expire.notCalled).to.be.true;
  });

  it("should indicate when count is over max queries", async () => {
    const domain = "test.com";
    const maxQueries = 10;
    const intervalInSeconds = 60;

    const request: IRequestContext = {
      trace_id: "TEST_TRACE_ID",
    };

    redisClient.incr.resolves(11);
    redisClient.ttl.resolves(30);

    const result = await service.incrementRateLimit(
      request,
      domain,
      maxQueries,
      intervalInSeconds,
    );

    expect(result.countOverMax).to.be.true;
    expect(result.count).to.equal(11);
    expect(result.ttl).to.equal(30);
    expect(redisClient.expire.notCalled).to.be.true;
  });
});
