import {
  ILoggerService,
  ILoggerServiceContext,
} from "dweb-api-types/dist/logger";

export class JsonLoggerService implements ILoggerService {
  private log(
    level: string,
    message: string,
    context: ILoggerServiceContext,
  ): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      origin: context.origin,
      trace_id: context.trace_id,
      context: context.context || {},
    };
    console.log(JSON.stringify(logEntry));
  }

  error(message: string, context: ILoggerServiceContext): void {
    this.log("error", message, context);
  }

  warn(message: string, context: ILoggerServiceContext): void {
    this.log("warn", message, context);
  }

  info(message: string, context: ILoggerServiceContext): void {
    this.log("info", message, context);
  }

  debug(message: string, context: ILoggerServiceContext): void {
    this.log("debug", message, context);
  }
}
