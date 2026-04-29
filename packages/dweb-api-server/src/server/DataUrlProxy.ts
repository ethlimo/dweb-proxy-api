import type { IRequestContext } from "dweb-api-types/request-context";
import express from "express";
import { getTraceIdFromRequest } from "../utils/index.js";
import { SharedServer } from "./index.js";
import { DecodedEIP8121HookSchema } from "dweb-api-types/ens-resolver";
import { isError, errorBuilder } from "../expressErrors/index.js";

//this function should not copy
function getByteLength(str: string) {
  const encoder = new TextEncoder();
  const encodedBytes = encoder.encode(str);
  return encodedBytes.byteLength;
}

function formatBytesToKiB(bytes: number): string {
  const kib = bytes / 1024;
  return kib.toFixed(2) + " KiB";
}

export class DataUrlProxy extends SharedServer {
  async queryDataUrl(request: IRequestContext, ensname: string) {
    this._logger.debug(`Querying data URL`, {
      ...request,
      origin: "DataUrlProxy/queryDataUrl",
      context: {
        ensname,
      },
    });
  }

  start(registerServer: (server: import("http").Server) => void = () => {}) {
    const app = express();
    const port = this._configurationService
      .getDataUrlServerConfig()
      .getDataUrlServerListenPort();

    const server = app.listen(port, () => {
      this._logger.info(`DataUrlProxy listening on port ${port}`, {
        origin: "DataUrlProxy/start",
        trace_id: "UNDEFINED_TRACE_ID",
      });
    });
    registerServer(server);

    const get = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      const trace_id = getTraceIdFromRequest(req);
      const request: IRequestContext = {
        trace_id,
      };
      const ensname = decodeURIComponent(req.params.ensname as string);
      const encodedPayload = req.params.payload as string;

      this._logger.debug(`Received request for data URL`, {
        ...request,
        origin: "DataUrlProxy/get",
        context: {
          ensname,
          encodedPayload,
        },
      });

      const base64DecodedPayload = Buffer.from(
        encodedPayload,
        "base64url",
      ).toString("utf8");

      const record = DecodedEIP8121HookSchema.safeParse(
        JSON.parse(base64DecodedPayload),
      );
      if (!record.success) {
        this._logger.error(`Failed to parse decoded EIP-8121 hook payload`, {
          ...request,
          origin: "DataUrlProxy/get",
          context: {
            ensname,
            encodedPayload,
            parseError: record.error,
          },
        });
        errorBuilder(res, 400, "Bad Request: Invalid EIP-8121 hook payload");
        return;
      }

      if (!this._dataUrlResolverService) {
        this._logger.error(`Data URL resolver service not initialized`, {
          ...request,
          origin: "DataUrlProxy/get",
          context: {
            ensname,
          },
        });
        isError(res);
        return;
      }

      const ret = await this._dataUrlResolverService
        .resolveDataUrl(request, {
          ensname,
          data: record.data,
          _tag: "DataUrlRecord",
        })
        .catch((error) => {
          this._logger.error(`Error when resolving data URL`, {
            ...request,
            origin: "DataUrlProxy/get",
            context: {
              ensname,
              error,
            },
          });
          throw error;
        });

      const data = Buffer.from(ret.data.slice(2), "hex").toString("utf8");
      if (data.startsWith("data:")) {
        const dataUrlMaxLength = this._configurationService
          .getDataUrlServerConfig()
          .getDataUrlMaxLength();
        if (getByteLength(data) > dataUrlMaxLength) {
          //INFO: 501 because the cdn can't handle 413
          errorBuilder(
            res,
            501,
            "Data URL too large (" + formatBytesToKiB(dataUrlMaxLength) + " max)",
          );
          return;
        }
        const matches = data.match(/^data:([^;]+)(;base64)?,(.*)$/);
        if (!matches) {
          errorBuilder(res, 400, "Invalid data URL");
          return;
        }

        const mimeType = matches[1];
        const isBase64 = !!matches[2];
        const dataBody = matches[3];

        const buffer = isBase64
          ? Buffer.from(dataBody, "base64")
          : Buffer.from(decodeURIComponent(dataBody), "utf8");

        res.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Disposition": "inline",
          "Content-Length": buffer.length,
        });
        res.write(buffer);
        res.end();
        return;
      } else {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment",
          "Content-Length": buffer.length,
        });
        res.write(buffer);
        res.end();
        return;
      }
    };

    app.get("/api/v1/dataurl/:ensname/:payload", async (req, res) => {
      await get(req, res).catch((error) => {
        this._logger.error(`Error processing request for data URL`, {
          origin: "DataUrlProxy/get",
          trace_id: getTraceIdFromRequest(req),
          context: { error },
        });
        isError(res);
      });
    });
  }
}
