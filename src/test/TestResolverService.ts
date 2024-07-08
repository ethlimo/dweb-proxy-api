import { ErrorSuccess } from "../utils/ErrorSuccess";
import { injectable } from "inversify";
import { INameService, Tag, ErrorType } from "../services/NameService";
import { IArweaveResolver } from "../services/EnsResolverService/arweave";
import { IRequestContext } from "../services/lib";

@injectable()
export class TestResolverService implements INameService, IArweaveResolver {
  mappings = new Map<string, string | null | {
    error: true | "throws";
    reason: string;
  }>();
  //TODO: this is a hack, scripts/dump_test_cases.ts should run arweave cases through resolveArweave as an extra parameter
  resolveArweave: (request: IRequestContext, tx_id: string, ens_name: string) => Promise<string> = async (request: IRequestContext, tx_id: string, ens_name: string) => {
    const res = this.mappings.get(tx_id);
    if (res === undefined) {
      throw new Error(`TestResolverService: no mapping for ${ens_name}`);
    }
    if (typeof res === "string") {
      return res.startsWith("arweave://") ? res.substring("arweave://".length) : res;
    }
    if (!res || res.error) {
      throw new Error(res?.reason);
    }
    throw new Error("TestResolverService: invalid mapping");
  }

  getContentHash(
    request: IRequestContext,
    name: string
  ): Promise<ErrorSuccess<string | null, Tag, ErrorType>> {
    const res = this.mappings.get(name);
    if (res === undefined) {
      throw new Error(`TestResolverService: no mapping for ${name}`);
    }
    if (!res) {
      return Promise.resolve({
        error: false,
        result: null,
      });
    }
    if (typeof res === "string") {
      return Promise.resolve({
        error: false,
        result: res,
      });
    }
    if (res.error === "throws") {
      throw new Error(res.reason);
    }
    return Promise.resolve({
      error: true,
      reason: res.reason,
      _tag: "IEnsServiceError",
      _type: "error",
    });
  }

  set(name: string, value: string | null | { error: true | 'throws'; reason: string; }) {
    this.mappings.set(name, value);
  }
}
