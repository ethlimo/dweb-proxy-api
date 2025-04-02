import { INameService } from "dweb-api-types/dist/name-service.js";
import { IArweaveResolver } from "dweb-api-types/dist/arweave.js";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";

export class TestResolverService implements INameService, IArweaveResolver {
  mappings = new Map<
    string,
    | string
    | null
    | {
        error: true;
        reason: string;
      }
  >();
  //TODO: this is a hack, scripts/dump_test_cases.ts should run arweave cases through resolveArweave as an extra parameter
  resolveArweave: (
    request: IRequestContext,
    tx_id: string,
    ens_name: string,
  ) => Promise<string> = async (
    request: IRequestContext,
    tx_id: string,
    ens_name: string,
  ) => {
    const res = this.mappings.get(tx_id);
    if (res === undefined) {
      throw new Error(`TestResolverService: no mapping for ${ens_name}`);
    }
    if (typeof res === "string") {
      return res.startsWith("arweave://")
        ? res.substring("arweave://".length)
        : res;
    }
    if (!res || res.error) {
      throw new Error(res?.reason);
    }
    throw new Error("TestResolverService: invalid mapping");
  };

  getContentHash(
    _request: IRequestContext,
    name: string,
  ): Promise<string | null> {
    const res = this.mappings.get(name);
    if (res === undefined) {
      throw new Error(`TestResolverService: no mapping for ${name}`);
    }
    if (!res) {
      return new Promise((resolve) => resolve(null));
    }
    if (typeof res === "string") {
      return new Promise((resolve) => resolve(res));
    }
    throw new Error(res.reason);
  }

  set(name: string, value: string | null | { error: true; reason: string }) {
    this.mappings.set(name, value);
  }
}
