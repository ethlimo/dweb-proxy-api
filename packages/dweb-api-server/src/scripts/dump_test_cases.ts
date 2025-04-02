import "reflect-metadata";
import {
  TestConfigurationService,
  getDefaultServerConfiguration,
} from "../configuration";
import {
  ArweaveResolver,
  arweaveTxIdToArweaveSandboxSubdomainId,
} from "dweb-api-resolver/dist/resolver/arweave";
import { LoggerService } from "dweb-api-logger/dist/index";
import { EnsService } from "dweb-api-resolver/dist/nameservice/EnsService";

const configurationService = new TestConfigurationService();
//this is a hack to ensure certain values (i.e. no logging) on the configuration service
//logging is disabled for easy piping
configurationService.set((conf) => {
  const cfg = (getDefaultServerConfiguration() as any)
    ._innerConfigurationObject;
  conf.ens = cfg.ens;
  conf.arweave = cfg.arweave;
  conf.ipfs = cfg.ipfs;
  conf.swarm = cfg.swarm;
  conf.logging = cfg.logging;
  conf.logging.level = "none";
  conf.cache = cfg.cache;
  conf.cache.ttl = 5;
  conf.router = cfg.router;
  conf.ethereum = cfg.ethereum;
});

const loggerService = new LoggerService(configurationService);
const ensService = new EnsService(configurationService, loggerService);
const arweaveService = new ArweaveResolver(loggerService);

const testCases = [
  {
    name: "blockranger.eth",
    type: "ipfs",
  },
  {
    name: "fast-ipfs.eth",
    type: "ipfs",
  },
  {
    name: "surveychain.eth",
    type: "ipfs",
  },
  {
    name: "easy-rln.eth",
    type: "ipfs",
  },
  {
    name: "view-code.eth",
    type: "ipfs",
  },
  {
    name: "makesy.eth",
    type: "arweave",
  },
  {
    name: "swarm.eth",
    type: "swarm",
  },
  {
    name: "nick.eth",
    type: "ipns",
  },
  {
    name: "not-a-real-ens-name-ahsalabadkadvhda.eth", //don't register this lmao
    type: "none",
  },
];

const main = async () => {
  const results = [];
  for (const testCase of testCases) {
    const request = {
      trace_id: "TEST_TRACE_ID",
    };
    const contentHash = await ensService.getContentHash(request, testCase.name);
    const additionalInfo: Partial<{
      arweave: {
        result: string;
        query: string;
        subdomain_sandbox_id: string;
      };
    }> = {};
    if (testCase.type === "arweave") {
      if (!contentHash) {
        throw "arweave result is null";
      }
      const ar_id = contentHash.split("arweave://")[1];
      const arweaveResult = await arweaveService.resolveArweave(
        request,
        ar_id,
        testCase.name,
      );
      const subdomain_sandbox_id = await arweaveTxIdToArweaveSandboxSubdomainId(
        request,
        loggerService,
        ar_id,
      );
      if (!subdomain_sandbox_id) {
        throw "subdomain_sandbox_id is null";
      }
      additionalInfo.arweave = {
        result: arweaveResult,
        query: ar_id,
        subdomain_sandbox_id,
      };
    }

    results.push({
      name: testCase.name,
      type: testCase.type,
      contentHash: contentHash,
      additionalInfo,
    });
  }
  console.log(JSON.stringify(results, null, 2));
};

main();
