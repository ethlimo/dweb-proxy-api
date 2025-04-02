import { Response } from "express";

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
