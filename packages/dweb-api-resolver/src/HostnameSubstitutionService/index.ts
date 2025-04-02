import {
  HostnameSubstitutionConfiguration,
  IConfigHostnameSubstitution,
} from "dweb-api-types/dist/config";
import { ILoggerService } from "dweb-api-types/dist/logger";

export interface IHostnameSubstitutionService {
  substituteHostname(hostname: string): string;
}

export class HostnameSubstitutionService
  implements IHostnameSubstitutionService
{
  _configuration: HostnameSubstitutionConfiguration;
  _logger: ILoggerService;

  constructor(
    configurationService: IConfigHostnameSubstitution,
    logger: ILoggerService,
  ) {
    const config = configurationService.getHostnameSubstitutionConfig();
    this._configuration = {};
    this._logger = logger;
    const logger_context = {
      origin: "HostnameSubstitutionService",
      trace_id: "UNDEFINED_TRACE_ID",
    };
    for (const key in config) {
      if (typeof config[key] === "string") {
        this._configuration[key] = config[key];
        logger.debug(`Registered suffix ${key}=${config[key]}`, {
          ...logger_context,
          context: {
            key,
            value: config[key],
            configuration: this._configuration,
          },
        });
      } else {
        logger.error("Invalid hostname substitution configuration", {
          ...logger_context,
          context: {
            key,
            value: config[key],
          },
        });
      }
    }

    logger.info("Hostname substitution service initialized", {
      ...logger_context,
      context: {
        substitutions: this._configuration,
      },
    });
  }
  substituteHostname(url: string): string {
    const logger_context = {
      origin: "HostnameSubstitutionService",
      //TODO: add this TRACE_ID
      trace_id: "UNDEFINED_TRACE_ID",
    };

    var host: URL;
    var strip: boolean = false;
    try {
      host = new URL(url);
    } catch (e) {
      try {
        host = new URL("http://" + url);
        strip = true;
      } catch (e) {
        this._logger.info("Hostname can not be substituted, invalid URL", {
          ...logger_context,
          context: {
            url,
          },
        });
        return url;
      }
    }

    const [hostname] = host.host.split(":");
    for (const key in this._configuration) {
      if (hostname.endsWith(key)) {
        const new_hostname =
          hostname.substring(0, hostname.length - key.length) +
          this._configuration[key];

        let recombined_hostname = new_hostname;

        this._logger.debug(
          `Substituted hostname ${hostname} -> ${recombined_hostname}`,
          {
            ...logger_context,
            context: {
              key,
              value: this._configuration[key],
              hostname: host.hostname,
              new_hostname: recombined_hostname,
            },
          },
        );

        const new_url = new URL(strip ? "https://" + url : url);
        new_url.host = recombined_hostname;
        new_url.protocol = "https:";
        var ret;
        ret = new_url.toString().substring("https://".length);

        while (ret.endsWith("/") && !url.endsWith("/")) {
          ret = ret.substring(0, ret.length - 1);
        }
        return ret;
      }
    }

    this._logger.debug(`No substitution for hostname ${host.toString()}`, {
      ...logger_context,
      context: {
        hostname: host.host,
      },
    });
    return url;
  }
}
