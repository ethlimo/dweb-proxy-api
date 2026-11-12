import {
  FetchRequest,
  JsonRpcProvider,
  type JsonRpcApiProviderOptions,
  type JsonRpcPayload,
  type JsonRpcResult,
  type Networkish,
} from "ethers";

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
export class FailoverJsonRpcProvider extends JsonRpcProvider {
  #endpoints: FetchRequest[];

  constructor(
    endpoints: FetchRequest[],
    network?: Networkish,
    options?: JsonRpcApiProviderOptions,
  ) {
    if (endpoints.length === 0) {
      throw new Error("FailoverJsonRpcProvider needs at least one endpoint");
    }
    super(endpoints[0], network, options);
    this.#endpoints = endpoints;
  }

  async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<Array<JsonRpcResult>> {
    let lastError: unknown = null;
    for (const endpoint of this.#endpoints) {
      const request = endpoint.clone();
      request.body = JSON.stringify(payload);
      request.setHeader("content-type", "application/json");
      try {
        const response = await request.send();
        response.assertOk();
        const body = response.bodyJson;
        return Array.isArray(body) ? body : [body];
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}
