import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { IConfigurationService } from "../../configuration";
import { ILoggerService } from "../LoggerService";

export type SubstitutionConfiguration = {
    [key: string]: string;
}

export interface IHostnameSubstitutionService {
    substituteHostname(hostname: string): string;
}

function parseRawConfig(rawConfig: string): SubstitutionConfiguration {
    try {
        return JSON.parse(Buffer.from(rawConfig, 'base64').toString());
    } catch {
        // Fallback to plain JSON
    }
    try {
        return JSON.parse(rawConfig);
    } catch(e) {
        throw new Error(`Invalid hostname substitution configuration: ${e.message}`);
    }
}

@injectable()
export class HostnameSubstitutionService implements IHostnameSubstitutionService {
    _configuration: SubstitutionConfiguration;
    _logger: ILoggerService;

    constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService,
                @inject(DITYPES.LoggerService) logger: ILoggerService) {
        const config = parseRawConfig(configurationService.get().router.hostnameSubstitutionConfig);
        this._configuration = {};
        this._logger = logger;
        const logger_context = {
            origin: 'HostnameSubstitutionService',
            trace_id: "UNDEFINED_TRACE_ID",
        }
        for (const key in config) {
            if(typeof config[key] === "string") {
                this._configuration[key] = config[key];
                logger.debug(`Registered suffix ${key}=${config[key]}`, {
                    ...logger_context,
                    context: {
                        key,
                        value: config[key],
                        configuration: this._configuration
                    }
                });
            } else {
                logger.error('Invalid hostname substitution configuration', {
                    ...logger_context,
                    context: {
                        key,
                        value: config[key]
                    }
                });
            }
        }

        logger.info('Hostname substitution service initialized', {
            ...logger_context,
            context: {
                substitutions: this._configuration
            }
        });
    }

    substituteHostname(hostname: string): string {
        const logger_context = {
            origin: 'HostnameSubstitutionService',
            trace_id: "UNDEFINED_TRACE_ID",
        }
        for (const key in this._configuration) {
            if (hostname.endsWith(key)) {
                const new_hostname = hostname.substring(0, hostname.length - key.length) + this._configuration[key];
                this._logger.debug(`Substituted hostname ${hostname} -> ${new_hostname}`, {
                    ...logger_context,
                    context: {
                        key,
                        value: this._configuration[key],
                        hostname,
                        new_hostname
                    }
                });
                return new_hostname;
            }
        }
        this._logger.debug(`No substitution for hostname ${hostname}`, {
            ...logger_context,
            context: {
                hostname
            }
        });
        return hostname;
    }
}