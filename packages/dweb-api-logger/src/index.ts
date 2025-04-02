import { createLogger, format, transports, Logger } from "winston";
import {
  ILoggerService,
  ILoggerServiceContext,
} from "dweb-api-types/dist/logger";
import { IConfigurationLogger } from "dweb-api-types/dist/config";

export class LoggerService implements ILoggerService {
  _configurationService: IConfigurationLogger;
  _logger: Logger;

  constructor(configurationService: IConfigurationLogger) {
    this._configurationService = configurationService;
    this._logger = createLogger({
      level: this._configurationService.getLoggerConfig().getLevel(),
      format: format.json(),
      defaultMeta: { service: "limo-proxy" },
    }).add(
      new transports.Console({
        format: format.json(),
      }),
    );
  }

  internal_log(
    severity: "warn" | "error" | "info" | "debug",
    msg: string,
    context: ILoggerServiceContext,
  ) {
    this._logger.log({
      level: severity,
      message: msg,
      ...context,
    });
  }

  public warn(msg: string, context: ILoggerServiceContext) {
    this.internal_log("warn", msg, context);
  }
  public error(msg: string, context: ILoggerServiceContext) {
    this.internal_log("error", msg, context);
  }
  public info(msg: string, context: ILoggerServiceContext) {
    this.internal_log("info", msg, context);
  }
  public debug(msg: string, context: ILoggerServiceContext) {
    this.internal_log("debug", msg, context);
  }
}

type TestLoggerServiceEnum = "warn" | "error" | "info" | "debug";
type TestLoggerServiceMsg = {
  severity: TestLoggerServiceEnum;
  message: string;
  ctx: any;
};

/**
 * This is a test logger service for configurable squelching of logs
 * when debugging tests, call logMessages before expect values to interrogate the log stack
 * note: the debug configuration should automatically set log level to DEBUG so reusing the logger is fine
 */
export class TestLoggerService implements ILoggerService {
  _configurationService: IConfigurationLogger;
  _logger: ILoggerService;
  msgs: TestLoggerServiceMsg[] = [];
  constructor(configurationService: IConfigurationLogger) {
    this._configurationService = configurationService;
    this._logger = new LoggerService(configurationService);
  }

  public warn(msg: string) {
    this.msgs.push({ severity: "warn", message: msg, ctx: null });
  }
  public error(msg: string, ctx: any) {
    this.msgs.push({ severity: "error", message: msg, ctx: ctx });
  }
  public info(msg: string) {
    this.msgs.push({ severity: "info", message: msg, ctx: null });
  }
  public debug(msg: string) {
    this.msgs.push({ severity: "debug", message: msg, ctx: null });
  }
  public logMessages() {
    for (let i = 0; i < this.msgs.length; i++) {
      let msg = this.msgs[i];
      this._logger[msg.severity](msg.message, msg.ctx);
    }
    this.clearMessages();
  }

  public clearMessages() {
    this.msgs = [];
  }
}
