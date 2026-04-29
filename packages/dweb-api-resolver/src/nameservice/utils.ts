import { decode, getCodec } from "@ensdomains/content-hash";
import { ILoggerService } from "dweb-api-types/logger";
import {
  DecodedCodecString,
  DecodedDataUri,
  DecodedDataUrl,
} from "dweb-api-types/name-service";
import { IRequestContext } from "dweb-api-types/request-context";
import { getBytes } from "ethers";
import { detectAndDecodeHook, tryDecodeDataUri } from "@ethlimo/ens-hooks";

const fixCodecReturnValue = (codec: string | undefined): string | undefined => {
  if (codec === "swarm") {
    return "bzz";
  }
  return codec;
};

export const getContentHashFallback = async (
  request: IRequestContext,
  logger: ILoggerService,
  res: string, //e.info.data
  name: string,
  serviceName: string,
): Promise<DecodedCodecString | DecodedDataUri | DecodedDataUrl | null> => {
  //dataurl and datauri handling block
  try {
    const DecodedDataUriResult = tryDecodeDataUri(res);
    if (DecodedDataUriResult) {
      logger.debug("detected data URI", {
        ...request,
        origin: serviceName,
        context: {
          name,
          dataUri: res,
          decodedDataUri: DecodedDataUriResult,
        },
      });
      return {
        _tag: "DecodedDataUri",
        data: DecodedDataUriResult,
      };
    }

    const decodedHook = await detectAndDecodeHook(res);
    if (decodedHook) {
      logger.debug("detected data hook", {
        ...request,
        origin: serviceName,
        context: {
          name,
          datahook: res,
          decodedHook,
        },
      });
      return {
        _tag: "DecodedDataUrl",
        data: decodedHook,
        callData: getBytes(res),
      };
    }
  } catch (e) {
    logger.debug("failed to decode datahook", {
      ...request,
      origin: serviceName,
      context: {
        name,
        datahook: res,
        error: e,
      },
    });
  }

  const codec = fixCodecReturnValue(getCodec(res));
  const content = decode(res);

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
  return {
    codec: contentHashDecoded,
    _tag: "DecodedCodecString",
  };
};
