import cluster from "node:cluster";
import type {
  ILoggerService,
  ILoggerServiceContext,
} from "dweb-api-types/logger";
type ProcessAwareContext = {
  pid: number;
  ppid: number;
  role: "primary" | "worker" | "standalone";
  worker_id?: number;
};

function getProcessAwareContext(): ProcessAwareContext {
  if (cluster.isPrimary) {
    return {
      pid: process.pid,
      ppid: process.ppid,
      role: "primary",
    };
  }

  if (cluster.isWorker) {
    return {
      pid: process.pid,
      ppid: process.ppid,
      role: "worker",
      worker_id: cluster.worker?.id,
    };
  }

  return {
    pid: process.pid,
    ppid: process.ppid,
    role: "standalone",
  };
}

function injectProcessContext(
  context: ILoggerServiceContext,
): ILoggerServiceContext {
  return {
    ...context,
    context: {
      ...(context.context ?? {}),
      process: getProcessAwareContext(),
    },
  };
}

export function withProcessLogger(logger: ILoggerService): ILoggerService {
  return {
    error: (message, context) => {
      logger.error(message, injectProcessContext(context));
    },
    warn: (message, context) => {
      logger.warn(message, injectProcessContext(context));
    },
    info: (message, context) => {
      logger.info(message, injectProcessContext(context));
    },
    debug: (message, context) => {
      logger.debug(message, injectProcessContext(context));
    },
  };
}
