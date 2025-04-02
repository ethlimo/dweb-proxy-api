import { ILoggerService } from "dweb-api-types/dist/logger";
import superagent from "superagent";
import { IRequestContext } from "dweb-api-types/dist/request-context";
import { normalizeUrlFragmentForIpfsSubdomainGateway } from "dweb-api-resolver/dist/resolver/utils";
import { IConfigurationKubo } from "dweb-api-types/dist/config";

export class KuboApiService {
  private loggerService: ILoggerService;
  private configurationService: IConfigurationKubo;
  private agent: superagent.SuperAgentStatic;

  constructor(
    loggerService: ILoggerService,
    configurationService: IConfigurationKubo,
  ) {
    this.loggerService = loggerService;
    this.configurationService = configurationService;
    this.agent = superagent;
    const koboConfig = this.configurationService.getKuboConfiguration();
    const koboUrl = koboConfig.getKuboApiUrl();
    const logObject = {
      trace_id: "UNKNOWN_TRACE_ID",
      origin: "KuboApiService",
      context: {
        url: koboUrl,
      },
    };
    if (!koboUrl) {
      this.loggerService.info(
        "Kubo API URL is not set, all requests will be ignored.",
        logObject,
      );
    } else {
      this.loggerService.info(`Kubo API URL is set`, logObject);
    }
  }

  async resolveIpnsName(
    request: IRequestContext,
    name: string,
  ): Promise<string | null> {
    try {
      const koboConfig = this.configurationService.getKuboConfiguration();
      const url = koboConfig.getKuboApiUrl();
      const auth = koboConfig.getKuboAuth();
      const timeout = koboConfig.getKuboTimeoutMs();
      if (!url) {
        this.loggerService.debug("Superagent is not initialized", {
          ...request,
          origin: "KuboApiService",
          context: {
            name,
          },
        });
        return null;
      }
      var superagentRequest = this.agent(
        "POST",
        `${url}api/v0/name/resolve`,
      ).query({
        arg: normalizeUrlFragmentForIpfsSubdomainGateway(
          name.split("ipns://")[1],
        ),
        recursive: true,
        nocache: true,
        "dht-record-count": 16,
        "dht-timeout": "1m0s",
        stream: false,
      });

      if (auth) {
        superagentRequest = superagentRequest.set(
          "Authorization",
          `Basic ${auth}`,
        );
      }

      const response = await superagentRequest
        .timeout(timeout || 5000)
        .ok((_res) => true);

      if (response.error) {
        this.loggerService.debug("Failed to resolve IPNS name", {
          ...request,
          origin: "KuboApiService",
          context: {
            name,
            response: response,
          },
        });
        return null;
      } else {
        return response.body?.Path || null;
      }
    } catch (error) {
      this.loggerService.error("failed to statically resolve IPNS name", {
        ...request,
        origin: "KuboApiService",
        context: {
          name,
          error: error,
        },
      });
      return null;
    }
  }
}
