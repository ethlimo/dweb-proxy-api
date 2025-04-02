import { decode, getCodec } from "@ensdomains/content-hash";
import { ILoggerService } from "dweb-api-types/dist/logger";
import { IRequestContext } from "dweb-api-types/dist/request-context";

const fixCodecReturnValue = (codec: string | undefined): string | undefined => {
  if (codec === "swarm") {
    return "bzz";
  }
  return codec;
};

export const getContentHashFallback = (
  request: IRequestContext,
  logger: ILoggerService,
  res: string,
  name: string,
  serviceName: string,
): string | null => {
  const codec = fixCodecReturnValue(getCodec(res));
  const content = decode(res);

  console.log("codec", codec);
  if (!codec || !content) {
    logger.error("unsupported fallback decode operation", {
      ...request,
      origin: serviceName,
      context: {
        name,
        codec,
        content,
      },
    });
    return null;
  }
  const contentHashDecoded = `${codec}://${content}`;
  logger.debug("getContentHash", {
    ...request,
    origin: serviceName,
    context: {
      name,
      contentHash: contentHashDecoded,
    },
  });
  return contentHashDecoded;
};
