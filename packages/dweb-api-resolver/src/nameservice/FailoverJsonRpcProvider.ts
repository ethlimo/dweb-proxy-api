import {
  FetchRequest,
  JsonRpcProvider,
  type JsonRpcApiProviderOptions,
  type JsonRpcPayload,
  type JsonRpcResult,
  type Networkish,
} from "ethers";

// How long an endpoint that just failed is moved to the end of the list.
// Without this every request would wait for the full timeout of a hanging
// primary before trying the next endpoint.
const FAILED_ENDPOINT_COOLDOWN_MS = 30_000;

// JSON-RPC provider that sends each request to the first endpoint and moves
// on to the next one when the HTTP request fails (connection error, timeout,
// non 2xx status).
//
// ethers' FallbackProvider doesn't do this: it is built for consensus, so an
// error from one provider counts as an answer just like a result does. With
// quorum 1 a failing primary makes the whole lookup fail even though a
// working failover endpoint is configured.
//
// Only transport errors trigger the failover. A JSON-RPC error in the
// response (e.g. a revert, which CCIP-read relies on) is a valid answer and
// is returned as is.
//
// An endpoint that failed is tried last for FAILED_ENDPOINT_COOLDOWN_MS,
// after that it gets its normal place back.
export class FailoverJsonRpcProvider extends JsonRpcProvider {
  #endpoints: FetchRequest[];
  #failedUntil: number[];
  #cooldownMs: number;

  constructor(
    endpoints: FetchRequest[],
    network?: Networkish,
    options?: JsonRpcApiProviderOptions,
    cooldownMs = FAILED_ENDPOINT_COOLDOWN_MS,
  ) {
    if (endpoints.length === 0) {
      throw new Error("FailoverJsonRpcProvider needs at least one endpoint");
    }
    super(endpoints[0], network, options);
    this.#endpoints = endpoints;
    this.#failedUntil = endpoints.map(() => 0);
    this.#cooldownMs = cooldownMs;
  }

  async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<Array<JsonRpcResult>> {
    const now = Date.now();
    const coolingDown = (i: number) => (this.#failedUntil[i] > now ? 1 : 0);
    // sort is stable, so the configured order is kept within both groups
    const order = this.#endpoints
      .map((_, i) => i)
      .sort((a, b) => coolingDown(a) - coolingDown(b));

    let lastError: unknown = null;
    for (const i of order) {
      const request = this.#endpoints[i].clone();
      request.body = JSON.stringify(payload);
      request.setHeader("content-type", "application/json");
      try {
        const response = await request.send();
        response.assertOk();
        const body = response.bodyJson;
        this.#failedUntil[i] = 0;
        return Array.isArray(body) ? body : [body];
      } catch (e) {
        lastError = e;
        this.#failedUntil[i] = Date.now() + this.#cooldownMs;
      }
    }
    throw lastError;
  }
}
