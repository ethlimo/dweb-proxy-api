import "reflect-metadata"
import { DefaultConfigurationService, TestConfigurationService } from "../configuration";
import { EnsService } from "../services/EnsService";
import { LoggerService } from "../services/LoggerService";
import { ArweaveResolver, arweaveTxIdToArweaveSandboxSubdomainId } from "../services/EnsResolverService/arweave";

const configurationService = new TestConfigurationService();
//this is a hack to ensure certain values (i.e. no logging) on the configuration service
//logging is disabled for easy piping
configurationService.set((conf) => {
    const defaultConfigService = new DefaultConfigurationService();
    conf.ens = defaultConfigService.get().ens;
    conf.arweave = defaultConfigService.get().arweave;
    conf.ipfs = defaultConfigService.get().ipfs;
    conf.swarm = defaultConfigService.get().swarm;
    conf.logging = defaultConfigService.get().logging;
    conf.logging.level = "none";
    conf.cache = defaultConfigService.get().cache;
    conf.cache.ttl = 5;
    conf.router = defaultConfigService.get().router;
    conf.ethereum = defaultConfigService.get().ethereum;
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
    }
];

const main = async () => {
    const results = [];
    for (const testCase of testCases) {
        const contentHash = await ensService.getContentHash(testCase.name);
        const additionalInfo:Partial<{
            arweave: {
                result: string,
                query: string,
                subdomain_sandbox_id: string
            };
        }> = {};
        if(contentHash.error) {
            throw contentHash.error;
        }
        if(testCase.type === "arweave") {
            if(!contentHash.result) {
                throw "arweave result is null"
            }
            const ar_id = contentHash.result.split("arweave://")[1];
            const arweaveResult = await arweaveService.resolveArweave(ar_id, testCase.name);
            const subdomain_sandbox_id = await arweaveTxIdToArweaveSandboxSubdomainId(loggerService, ar_id)
            if(!subdomain_sandbox_id) {
                throw "subdomain_sandbox_id is null"
            }
            additionalInfo.arweave = {
                result: arweaveResult,
                query: ar_id,
                subdomain_sandbox_id
            }
        }

        results.push({ name: testCase.name, type: testCase.type, contentHash: contentHash.result, additionalInfo });
    }
    console.log(JSON.stringify(results, null, 2));
};

main()