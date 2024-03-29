import winston, { createLogger, format, transports } from "winston";
import { inject, injectable } from "inversify";
import { DITYPES } from "../../dependencies/types";
import { IConfigurationService } from "../../configuration";

type winstonLogger = ReturnType<typeof createLogger>;
export type ILoggerService = {
  error: (message: string, ctx?: any) => void;
  warn: (message: string) => void;
  info: (message: string) => void;
  debug: (message: string) => void;
};

@injectable()
export class LoggerService implements ILoggerService {
  _configurationService: IConfigurationService;
  _logger: winston.Logger;

  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService) {
    this._configurationService = configurationService;
    this._logger = createLogger({
      level: this._configurationService.get().logging.level,
      format: format.json(),
      defaultMeta: { service: "limo-proxy" },
    }).add(
      new transports.Console({
        format: format.json(),
      }),
    );
  }

  public warn(msg: string) {
    this._logger.warn(msg);
  }
  public error(msg: string, ctx: any) {
    this._logger.error(msg, ctx);
  }
  public info(msg: string) {
    this._logger.info(msg);
  }
  public debug(msg: string) {
    this._logger.debug(msg);
  }
}

type TestLoggerServiceEnum = 'warn' | 'error' | 'info' | 'debug';
type TestLoggerServiceMsg = {
  severity: TestLoggerServiceEnum,
  message: string,
  ctx: any
}

@injectable()
/**
 * This is a test logger service for configurable squelching of logs
 * when debugging tests, call logMessages before expect values to interrogate the log stack
 * note: the debug configuration should automatically set log level to DEBUG so reusing the logger is fine
 */
export class TestLoggerService implements ILoggerService {
  _configurationService: IConfigurationService;
  _logger: ILoggerService;
  msgs: TestLoggerServiceMsg[] = [];
  constructor(@inject(DITYPES.ConfigurationService) configurationService: IConfigurationService) {
    this._configurationService = configurationService;
    this._logger = new LoggerService(configurationService);
  };

  public warn(msg: string) {
    this.msgs.push({severity: 'warn', message: msg, ctx: null});
  }
  public error(msg: string, ctx: any) {
    this.msgs.push({severity: 'error', message: msg, ctx: ctx});
  }
  public info(msg: string) {
    this.msgs.push({severity: 'info', message: msg, ctx: null});
  }
  public debug(msg: string) {
    this.msgs.push({severity: 'debug', message: msg, ctx: null});
  }
  public logMessages() {
    for(let i = 0; i < this.msgs.length; i++) {
      let msg = this.msgs[i];
      this._logger[msg.severity](msg.message, msg.ctx);
    }
    this.clearMessages()
  }
  
  public clearMessages() {
    this.msgs = [];
  }
}