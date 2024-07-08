import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { ILoggerService } from "../LoggerService";
import superagent from "superagent";
import { IConfigurationService } from "../../configuration";
import { normalizeUrlFragmentForIpfsSubdomainGateway } from "../EnsResolverService/utils";
import { IRequestContext } from "../lib";

export interface IKuboApiService {
    resolveIpnsName(request: IRequestContext, name: string): Promise<string | null>;
}

@injectable()
export class KuboApiService {
    private loggerService: ILoggerService;
    private configurationService: IConfigurationService;
    private agent: superagent.SuperAgentStatic;

    private getUrl() {
        return this.configurationService.get().ipfs.kubo_api_url;
    }

    constructor(
        @inject(DITYPES.LoggerService) loggerService: ILoggerService,
        @inject(DITYPES.ConfigurationService) configurationService: IConfigurationService
    ) {
        this.loggerService = loggerService;
        this.configurationService = configurationService;
        this.agent = superagent;
        const logObject = {
            trace_id: "UNKNOWN_TRACE_ID",
            origin: "KuboApiService",
            context: {
                url: this.getUrl()
            }
        };
        if(!this.getUrl()) {
            this.loggerService.info("Kubo API URL is not set, all requests will be ignored.", logObject);
        } else {
            this.loggerService.info(`Kubo API URL is set`, logObject);
        }
    }

    async resolveIpnsName(request: IRequestContext, name: string): Promise<string | null> {
        try {
            const url = this.getUrl()?.toString();
            if(!url) {
                this.loggerService.debug("Superagent is not initialized", {
                    ...request,
                    origin: "KuboApiService",
                    context: {
                        name,
                    }
                });
                return null;
            }
            var superagentRequest = this.agent('POST', `${url}api/v0/name/resolve`).query({
                arg: normalizeUrlFragmentForIpfsSubdomainGateway(name.split("ipns://")[1]),
                recursive: true,
                nocache: true,
                "dht-record-count": 16,
                "dht-timeout": "1m0s",
                stream: false
            });

            if(this.configurationService.get().ipfs.auth) {
                superagentRequest = superagentRequest.set("Authorization", `Basic ${this.configurationService.get().ipfs.auth}`);
            }

            const response = await superagentRequest.timeout(this.configurationService.get().ipfs.kubo_timeout_ms).ok((_res) => true);

            if(response.error) {
                this.loggerService.debug('Failed to resolve IPNS name',
                {
                    ...request,
                    origin: 'KuboApiService',
                    context: {
                        name,
                        response: response
                    }
                });
                return null;
            } else {
                return response.body?.Path || null;
            }
        } catch (error) {
            this.loggerService.error(
                'failed to statically resolve IPNS name',
                {
                    ...request,
                    origin: 'KuboApiService',
                    context: {
                        name,
                        error: error
                    }
                });
            return null;
        }
    }

}