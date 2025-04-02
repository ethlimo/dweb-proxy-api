export type ILoggerService = {
  error: (message: string, context: ILoggerServiceContext) => void;
  warn: (message: string, context: ILoggerServiceContext) => void;
  info: (message: string, context: ILoggerServiceContext) => void;
  debug: (message: string, context: ILoggerServiceContext) => void;
};

export type ILoggerServiceContext = {
  origin: string;
  trace_id: string;
  context?: Object;
};
