import type { NextFunction, Request, Response } from "express";
import type { ILoggerService } from "dweb-api-types/logger";
import { getTraceIdFromRequest } from "../utils/index.js";

// Last middleware on every express app. Without it errors end up in the
// express default handler, which sends the stack trace (with file paths)
// to the client unless NODE_ENV is "production".
export function errorHandler(logger: ILoggerService, origin: string) {
  // express only treats middleware with 4 arguments as an error handler
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error("unhandled error in request handler", {
      trace_id: getTraceIdFromRequest(req),
      origin,
      context: {
        error: err,
        path: req.path,
      },
    });
    if (res.headersSent) {
      res.end();
      return;
    }
    errorBuilder(res, 500);
  };
}

export function noContentHashSet(res: Response) {
  res.writeHead(404, {
    "Content-Type": "text/plain",
  });
  res.write("Requested ENS name does not have a content hash set.");
  res.end();
}

export function notSupported(res: Response) {
  res.writeHead(422, {
    "Content-Type": "text/plain",
  });
  res.write("422");
  res.end();
}

export function blockedForLegalReasons(res: Response) {
  res.writeHead(451, {
    "Content-Type": "text/plain",
  });
  res.write("Requested content is not available due to legal reasons.");
  res.end();
}

export function errorBuilder(res: Response, code = 500, message?: string) {
  res.writeHead(code, {
    "Content-Type": "text/plain",
  });
  res.write(`Error ${code}\n`);
  if (message) {
    res.write(message);
  }
  res.end();
}

export function isError(res: Response) {
  res.writeHead(500, {
    "Content-Type": "text/plain",
  });
  res.write("500");
  res.end();
}
