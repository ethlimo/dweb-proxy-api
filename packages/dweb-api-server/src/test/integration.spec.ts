import { describe } from "mocha";
import { expect } from "chai";
// @ts-ignore //bug with parsing the type assertion
import cases from "./cases.json" with { type: "json" };
import { Server as ProxyServer } from "../server/index";
import {
  RequestMethod,
  RequestOptions,
  createRequest,
  createResponse,
} from "node-mocks-http";
import { TestRunner, cartesianProduct } from "./TestCaseGenerator";
import EventEmitter from "events";
import { Request, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { IRequestContext } from "dweb-api-types/dist/request-context.js";
import { TestResolverService } from "./TestResolverService";
import { createApplicationConfigurationBindingsManager } from "../dependencies/services.js";
import { TestConfigurationService } from "../configuration";
import {
  IDomainQueryService,
  TestDomainQuerySuperagentService,
} from "../services/DomainsQueryService";
import { EnvironmentConfiguration } from "../dependencies/BindingsManager";
import { IDnsQuery } from "../dnsquery";
import { IDomainRateLimitService } from "../services/DomainRateLimit";
import { IEnsResolverService } from "dweb-api-types/dist/ens-resolver";
import { getPeerId } from "dweb-api-resolver/dist/resolver/index";
import { normalizeUrlFragmentForIpfsSubdomainGateway } from "dweb-api-resolver/dist/resolver/utils";
import { IHostnameSubstitutionService } from "dweb-api-resolver/dist/HostnameSubstitutionService/index";
import {
  TestLaggyRedisClientProxy,
  TestRedisClient,
} from "dweb-api-cache/dist";
import { TestLoggerService } from "dweb-api-logger/dist/index";

type HarnessType = {
  configurationService: TestConfigurationService;
  redisClient: TestRedisClient;
  hostnameSubstitionService: IHostnameSubstitutionService;
  testEnsService: TestResolverService;
  web3NameSdkService: TestResolverService;
  testArweaveResolverService: TestResolverService;
  testDomainQuerySuperagentService: TestDomainQuerySuperagentService;
  domainQueryService: IDomainQueryService;
  testLoggerService: TestLoggerService;
  dnsQueryService: IDnsQuery;
  domainRateLimit: IDomainRateLimitService;
  ensResolverService: IEnsResolverService;
};

let buildAppContainer = (): HarnessType => {
  const services = createApplicationConfigurationBindingsManager();
  return {
    configurationService: services.configuration.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestConfigurationService,
    dnsQueryService: services.dnsQuery.getBinding(
      EnvironmentConfiguration.Development,
    ),
    domainRateLimit: services.domainRateLimit.getBinding(
      EnvironmentConfiguration.Development,
    ),
    hostnameSubstitionService: services.hostnameSubstitution.getBinding(
      EnvironmentConfiguration.Development,
    ),
    testEnsService: services.ensService.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestResolverService,
    web3NameSdkService: services.web3NameSdk.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestResolverService,
    testArweaveResolverService: services.arweaveResolver.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestResolverService,
    testDomainQuerySuperagentService: services.domainQuerySuperagent.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestDomainQuerySuperagentService,
    domainQueryService: services.domainQuery.getBinding(
      EnvironmentConfiguration.Development,
    ),
    testLoggerService: services.logger.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestLoggerService,
    redisClient: services.redisClient.getBinding(
      EnvironmentConfiguration.Development,
    ) as TestRedisClient,
    ensResolverService: services.ensResolver.getBinding(
      EnvironmentConfiguration.Development,
    ),
  };
};

type TestCaseType = {
  name: string;
  type: "ipfs" | "ipns" | "arweave" | "swarm" | "none";
  contentHash?: string;
  additionalInfo: Partial<{
    arweave: {
      result: string;
      query: string;
      subdomain_sandbox_id: string;
    };
  }>;
};

interface Options {
  subdomainSupport: boolean;
  ensSocialsRedirect: boolean;
  blacklisted: boolean | "throws";
  dohQueryType: "A" | "AAAA" | "CNAME" | "TXT";
  ensError: false | "throws";
  redisIsLaggy: boolean;
  ignoreTotalityError?: true;
}

const populateDefaultOptions = (options: Partial<Options>): Options => {
  return {
    subdomainSupport: true,
    ensSocialsRedirect: true,
    blacklisted: false,
    dohQueryType: "A",
    ensError: false,
    redisIsLaggy: false,
    ...options,
  };
};

const possibleOptions: Options[] = cartesianProduct({
  subdomainSupport: [true, false],
  ensSocialsRedirect: [true, false],
  blacklisted: [true, false, "throws"],
  dohQueryType: ["A", "AAAA", "CNAME", "TXT"],
  ensError: [false, "throws"],
  redisIsLaggy: [false, true],
}) as any as Options[];
var testCases = (cases as TestCaseType[])
  .map((testCase) => {
    return possibleOptions.map((options) => {
      return {
        ...testCase,
        options,
      };
    });
  })
  .flatMap((x) => x);
const gen = new TestRunner(testCases);

type HarnessProxyServerPayloadType =
  | {
      proxyServer: ProxyServer;
    }
  | {
      caddyServer: ProxyServer;
    }
  | {
      dohServerGetRequest: ProxyServer;
    };

function isProxyServerPayloadType(
  payload: any,
): payload is { proxyServer: ProxyServer } {
  return payload.proxyServer !== undefined;
}

function isCaddyServerPayloadType(
  payload: any,
): payload is { caddyServer: ProxyServer } {
  return payload.caddyServer !== undefined;
}

function isDohServerGetPayloadType(
  payload: any,
): payload is { dohServer: ProxyServer } {
  return payload.dohServerGetRequest !== undefined;
}

type HarnessPayloadType = HarnessProxyServerPayloadType;

const harness =
  (harnessInput: HarnessType) =>
  (payload: HarnessPayloadType) =>
  async (v: TestCaseType & { options: Options }) => {
    var { contentHash, additionalInfo, options } = v;

    if (options.redisIsLaggy) {
      harnessInput.redisClient.setProxy(
        new TestLaggyRedisClientProxy(harnessInput.configurationService),
      );
    }

    harnessInput.configurationService.set((conf) => {
      conf.ipfs.subdomainSupport = options.subdomainSupport;
      conf.ens.socialsEndpointEnabled = options.ensSocialsRedirect;
    });
    /*
                the distinction between these two variables is important:
                - nameResolvedToEnsName is the name that the query logic will (should) see
                - nameFromHostMayReferToSubdomainOfHostedProxyAddress is the name that the client will send to the server
                -- this means that it CAN be a .eth domain, or it can be a proxied domain such as "vitalik.eth.limo"
                -- the underlying assumption is that the server should be agnostic to the difference between these two
                -- the server should only care about the underlying ENS name
                -- if there's an underlying bug in the public facing interfaces of the server, that bug will end up passing the wrong name to either the query services or otherwise not respect the actual .eth ENS name
                
                for most of the test cases, nameResolvedToEnsName === nameFromHostMayReferToSubdomainOfHostedProxyAddress
            */

    const nameResolvedToEnsName =
      harnessInput.hostnameSubstitionService.substituteHostname(v.name);
    const nameFromHostMayReferToSubdomainOfHostedProxyAddress = v.name;

    var testEnsEnsServiceExpectedValue:
      | string
      | null
      | { error: true; reason: string }
      | undefined = contentHash;
    if (options.ensError) {
      testEnsEnsServiceExpectedValue = {
        error: !!options.ensError,
        reason: "test",
      };
    }

    const resolvers = [
      harnessInput.testEnsService,
      harnessInput.web3NameSdkService,
    ];

    var theRealTestResolverService: TestResolverService;

    if (nameResolvedToEnsName.endsWith("eth")) {
      theRealTestResolverService = harnessInput.testEnsService;
    } else if (nameResolvedToEnsName.endsWith("gno")) {
      theRealTestResolverService = harnessInput.web3NameSdkService;
    } else if (options?.ignoreTotalityError) {
      theRealTestResolverService = harnessInput.testEnsService;
    } else {
      throw "Test case non-totality error";
    }

    if (testEnsEnsServiceExpectedValue !== undefined) {
      theRealTestResolverService.set(
        nameResolvedToEnsName,
        testEnsEnsServiceExpectedValue,
      );
    }

    //poison the other resolvers to ensure our factory selects the correct one
    resolvers
      .filter((resolver) => resolver !== theRealTestResolverService)
      .forEach((resolver) => {
        if (testEnsEnsServiceExpectedValue === undefined) {
          resolver.set(nameResolvedToEnsName, "ASDFASDDFASDHDAHD bad value");
        } else {
          //implicit poisoning, undefined is the default
        }
      });

    if (additionalInfo.arweave) {
      harnessInput.testArweaveResolverService.set(
        additionalInfo.arweave.query,
        additionalInfo.arweave.result,
      );
    }
    if (options.blacklisted) {
      if (options.blacklisted === "throws") {
        //if the service errors, we want to be unavailable
        harnessInput.testDomainQuerySuperagentService.error = true;
      } else {
        harnessInput.testDomainQuerySuperagentService.setBlacklist(
          nameResolvedToEnsName,
          true,
        );
      }
    }
    const request = createRequestEnsureTotality(
      payload,
      nameFromHostMayReferToSubdomainOfHostedProxyAddress,
      options,
    );
    const req = createRequest(request);
    const res = createResponse({
      eventEmitter: EventEmitter,
    });
    var busyWaiting = true;
    res.on("end", () => {
      busyWaiting = false;
    });
    await callPayloadEnsureTotality(payload, req, res);
    while (busyWaiting) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const _result = res._getData();
    if (!res._isEndCalled()) {
      throw "Response not ended";
    }
    const content_location = res.getHeader("x-content-location");
    const content_path = res.getHeader("x-content-path");
    const content_storage_type = res.getHeader("x-content-storage-type");

    return {
      _result,
      res,
      content_location,
      content_path,
      content_storage_type,
    };
  };

describe("Proxy API Integration Tests", function () {
  var harnessInput: HarnessType;
  var server: ProxyServer;
  var commonSetup: any; //not even the language server can figure out what this is

  beforeEach(() => {
    let r = buildAppContainer();
    server = new ProxyServer(
      r.configurationService,
      r.testLoggerService,
      r.domainQueryService,
      r.ensResolverService,
      r.testArweaveResolverService,
      r.dnsQueryService,
      r.domainRateLimit,
      r.hostnameSubstitionService,
    );
    harnessInput = r;
    commonSetup = harness(harnessInput)({ proxyServer: server });
  });

  afterEach(() => {
    harnessInput = null as any;
    server = null as any;
    commonSetup = null as any;
  });

  gen.registerTests(
    "normal blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "dohQueryType"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        testCase.options.blacklisted === "throws"
      );
    },
    async function (testCase) {
      var { options } = testCase;

      const { res } = await commonSetup(testCase);

      if (options.blacklisted === "throws") {
        var expectedResponseCode = 200;
        if (options.ensError) {
          expectedResponseCode = 500;
        } else if (testCase.type === "none" && !options.ensSocialsRedirect) {
          expectedResponseCode = 404;
        }
        expect(res.statusCode).to.be.equal(expectedResponseCode);
      } else {
        expect(res.statusCode).to.be.equal(451);
      }
    },
  );

  gen.registerTests(
    "subdomain blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "dohQueryType"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        testCase.options.blacklisted === "throws"
      );
    },
    async function (originalTestCase) {
      const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
      for (const subdomain of subdomains) {
        var testCase = { ...originalTestCase };
        testCase.name = subdomain + "." + originalTestCase.name;
        if (originalTestCase.options.blacklisted === "throws") {
          //if the service errors, we want to be unavailable
          harnessInput.testDomainQuerySuperagentService.error = true;
        } else {
          harnessInput.testDomainQuerySuperagentService.setBlacklist(
            harnessInput.hostnameSubstitionService.substituteHostname(
              originalTestCase.name,
            ),
            true,
          );
        }
        const fudge = JSON.parse(JSON.stringify(testCase));
        fudge.options.blacklisted = false; //we don't want the subdomain blacklisted, just the original domain

        const { res } = await commonSetup(fudge);

        var { options } = testCase;
        if (options.blacklisted === "throws") {
          var expectedResponseCode = 200;
          if (options.ensError) {
            expectedResponseCode = 500;
          } else if (testCase.type === "none" && !options.ensSocialsRedirect) {
            expectedResponseCode = 404;
          }
          expect(res.statusCode).to.be.equal(
            expectedResponseCode,
            `subdomain: ${subdomain}`,
          );
        } else {
          expect(res.statusCode).to.be.gt(399, `subdomain: ${subdomain}`);
        }
      }
    },
  );

  gen.registerTests(
    "x-content-location and x-content-path",
    ["name", "type"],
    ["ensSocialsRedirect", "dohQueryType"],
    function (testCase) {
      return testCase.type === "ipfs" || testCase.type === "ipns";
    },
    async function (testCase) {
      var { type, name, contentHash, options } = testCase;
      const { content_location, content_path, content_storage_type, res } =
        await commonSetup(testCase);
      if (options.blacklisted === true) {
        expect(res.statusCode).to.be.equal(451);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      const request = {
        trace_id: "TEST_TRACE_ID",
      };

      contentHash = recalculateIpnsContentHash(
        request,
        type,
        contentHash,
        harnessInput,
        name,
      );
      if (options.subdomainSupport) {
        expect(content_path).to.be.equal(`/`);
        let fragment = contentHash?.substring(7);
        //see the en.wikipedia-on-ipfs.org testcase
        if (type === "ipns") {
          fragment =
            fragment && normalizeUrlFragmentForIpfsSubdomainGateway(fragment);
        }
        expect(content_location).to.be.equal(`${fragment}.${type}.ipfs`);
      } else {
        expect(content_path).to.be.equal(
          `/${type}/${contentHash?.substring(7)}/`,
        );
        expect(content_location).to.be.equal("ipfs");
      }
      expect(content_storage_type).to.be.equal(
        getCodecFromType(testCase.type as any),
      );
    },
  );
  gen.registerTests(
    "x-content-location and x-content-path",
    ["name", "type"],
    ["ensSocialsRedirect", "subdomainSupport", "dohQueryType"],
    function (testCase) {
      return testCase.type === "arweave";
    },
    async function (testCase) {
      var { contentHash, additionalInfo, options } = testCase;
      const { content_location, content_path, content_storage_type, res } =
        await commonSetup(testCase);
      if (options.blacklisted === true) {
        expect(res.statusCode).to.be.equal(451);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      expect(res.statusCode).to.be.equal(200);
      const ar_id = contentHash?.substring("arweave://".length);
      expect(content_path).to.be.equal("/" + ar_id + "/");
      expect(additionalInfo.arweave?.subdomain_sandbox_id).to.not.be.undefined; //this would be a bad test case if it was
      expect(content_location).to.be.equal(
        `${additionalInfo.arweave?.subdomain_sandbox_id}.arweave`,
      );
      expect(content_storage_type).to.be.equal(
        getCodecFromType(testCase.type as any),
      );
    },
  );
  gen.registerTests(
    "x-content-location and x-content-path",
    ["name", "type"],
    ["ensSocialsRedirect", "subdomainSupport", "dohQueryType"],
    function (testCase) {
      return testCase.type === "swarm";
    },
    async function (testCase) {
      var { contentHash, options } = testCase;
      const { content_location, content_path, content_storage_type, res } =
        await commonSetup(testCase);
      if (options.blacklisted === true) {
        expect(res.statusCode).to.be.equal(451);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      expect(res.statusCode).to.be.equal(200);
      expect(content_path).to.be.equal(
        "/bzz/" + contentHash?.substring("bzz://".length) + "/",
      );
      expect(content_location).to.be.equal("swarm");
      expect(content_storage_type).to.be.equal(
        getCodecFromType(testCase.type as any),
      );
    },
  );
  gen.registerTests(
    "x-content-location and x-content-path",
    ["name", "type"],
    ["subdomainSupport", "blacklisted", "dohQueryType"],
    function (testCase) {
      return testCase.type === "none";
    },
    async function (testCase) {
      var { name, options } = testCase;
      const { content_location, content_path, content_storage_type, res } =
        await commonSetup(testCase);

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
        expect(content_storage_type).to.be.undefined;
        return;
      }

      if (options.ensSocialsRedirect) {
        expect(res.statusCode).to.be.equal(200);
        expect(content_path).to.be.equal(`/?name=${name}/`);
        expect(content_location).to.be.equal("socials.com");
      } else {
        expect(res.statusCode).to.be.equal(404);
        expect(content_path).to.be.undefined;
        expect(content_location).to.be.undefined;
      }

      expect(content_storage_type).to.be.undefined;
    },
  );

  gen.runTests(this);
  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "127.0.0.1",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(200);
  });
  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "2607:f8b0:4009:804::200e",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(500);
  });

  it("should handle long IPFS ens names", async () => {
    const { res } = await commonSetup({
      name: "vitalik.jsonapi.eth",
      type: "ipfs",
      additionalInfo: {},
      contentHash:
        "ipfs://bagaaiaf4af5se33lei5hi4tvmuwce5djnvsseorcge3timzqgy4dknzzeiwceytmn5rwwir2eizdemjtg42denjcfqrgk4tdei5dalbcovzwk4rchj5seylemrzgk43tei5cemdymq4giqjwijddenrzgy2gcrrziq3wkrlehfstam2fguztimjviqztoykbhe3danbveiwce3tbnvsseorcozuxiylmnfvs4zlunarcyitcmfwgc3tdmurduirvgizc4nrsgq2teobcfqrha4tjmnsseorcgiydenzogm4tenzugirh27i",
      options: populateDefaultOptions({
        subdomainSupport: true,
      }),
    });
    expect(res.header("x-content-location")).to.equal(
      "vitalik-jsonapi-eth.ipns.ipfs",
    );
    expect(res.header("x-content-path")).to.equal("/");
    expect(res.header("x-content-storage-type")).to.equal("ipns-ns");
  });

  it("should preserve port in X-Content-Location for arweave with explicit port", async () => {
    // Set arweave backend with explicit non-default port
    harnessInput.configurationService.set((conf) => {
      conf.arweave.backend = "https://arweave.net:8443";
    });

    const { content_location, content_path, content_storage_type, res } =
      await commonSetup({
        name: "makesy.eth",
        type: "arweave",
        contentHash: "arweave://Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
        additionalInfo: {
          arweave: {
            result: "Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
            query: "Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
            subdomain_sandbox_id:
              "dlu34g6aqvgcecjb4dksklcazqpwunznwo73jaxafp7w4db3en4a",
          },
        },
        options: populateDefaultOptions({}),
      });

    expect(res.statusCode).to.be.equal(200);
    expect(content_location).to.be.equal(
      "dlu34g6aqvgcecjb4dksklcazqpwunznwo73jaxafp7w4db3en4a.arweave.net:8443",
    );
    expect(content_path).to.be.equal(
      "/Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g/",
    );
    expect(content_storage_type).to.be.equal("arweave-ns");
  });

  it("should preserve explicit default port 443 in X-Content-Location for arweave", async () => {
    // Set arweave backend with explicit default port 443
    harnessInput.configurationService.set((conf) => {
      conf.arweave.backend = "https://arweave.net:443";
    });

    const { content_location, content_path, content_storage_type, res } =
      await commonSetup({
        name: "makesy.eth",
        type: "arweave",
        contentHash: "arweave://Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
        additionalInfo: {
          arweave: {
            result: "Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
            query: "Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g",
            subdomain_sandbox_id:
              "dlu34g6aqvgcecjb4dksklcazqpwunznwo73jaxafp7w4db3en4a",
          },
        },
        options: populateDefaultOptions({}),
      });

    expect(res.statusCode).to.be.equal(200);
    expect(content_location).to.be.equal(
      "dlu34g6aqvgcecjb4dksklcazqpwunznwo73jaxafp7w4db3en4a.arweave.net:443",
    );
    expect(content_path).to.be.equal(
      "/Gum-G8CFTCIJIeDVJSxAzB9qNy2zv7SC4Cv_bgw7I3g/",
    );
    expect(content_storage_type).to.be.equal("arweave-ns");
  });
});

describe("Caddy API Integration Tests", function () {
  var harnessInput: HarnessType;
  var server: ProxyServer;
  var commonSetup: any; //not even the language server can figure out what this is

  beforeEach(() => {
    let r = buildAppContainer();
    server = new ProxyServer(
      r.configurationService,
      r.testLoggerService,
      r.domainQueryService,
      r.ensResolverService,
      r.testArweaveResolverService,
      r.dnsQueryService,
      r.domainRateLimit,
      r.hostnameSubstitionService,
    );
    harnessInput = r;
    commonSetup = harness(harnessInput)({ caddyServer: server });
  });

  afterEach(() => {
    harnessInput = null as any;
    server = null as any;
    commonSetup = null as any;
  });

  gen.registerTests(
    "normal blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "dohQueryType"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        testCase.options.blacklisted === "throws"
      );
    },
    async function (testCase) {
      var { options } = testCase;

      const { res } = await commonSetup(testCase);

      if (options.blacklisted === "throws") {
        var expectedResponseCode = 200;
        if (options.ensError) {
          expectedResponseCode = 500;
        } else if (testCase.type === "none" && !options.ensSocialsRedirect) {
          expectedResponseCode = 404;
        }
        expect(res.statusCode).to.be.equal(expectedResponseCode);
      } else {
        expect(res.statusCode).to.be.equal(451);
      }
    },
  );

  gen.registerTests(
    "subdomain blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "dohQueryType", "subdomainSupport"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        (testCase.options.blacklisted === "throws" && testCase.type !== "none")
      );
    },
    async function (originalTestCase) {
      const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
      for (const subdomain of subdomains) {
        var testCase = JSON.parse(JSON.stringify(originalTestCase));
        testCase.name = subdomain + "." + originalTestCase.name;
        if (originalTestCase.options.blacklisted === "throws") {
          //if the service errors, we want to be unavailable
          harnessInput.testDomainQuerySuperagentService.error = true;
        } else {
          harnessInput.testDomainQuerySuperagentService.setBlacklist(
            harnessInput.hostnameSubstitionService.substituteHostname(
              originalTestCase.name,
            ),
            true,
          );
        }
        const fudge = JSON.parse(JSON.stringify(testCase));

        fudge.options.blacklisted = false; //we don't want the subdomain blacklisted, just the original domain

        const { res } = await commonSetup(fudge);

        var { options } = testCase;
        if (options.blacklisted === "throws" && options.ensError !== "throws") {
          expect(res.statusCode).to.be.equal(200);
          return;
        }

        expect(res.statusCode).to.be.greaterThan(399);
      }
    },
  );

  gen.registerTests(
    "permutation",
    ["name", "type"],
    ["subdomainSupport", "dohQueryType"],
    function (testCase) {
      return (
        testCase.type === "ipfs" ||
        testCase.type === "ipns" ||
        testCase.type === "arweave" ||
        testCase.type === "swarm"
      );
    },
    async function (testCase) {
      var { options } = testCase;
      const { res } = await commonSetup(testCase);
      if (options.ensError && options.blacklisted !== true) {
        expect(res.statusCode).to.be.equal(500);
        return;
      }
      if (options.blacklisted) {
        if (options.blacklisted === "throws") {
          expect(res.statusCode).to.be.equal(200);
        } else {
          expect(res.statusCode).to.be.equal(451);
        }
        return;
      }

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        return;
      }

      expect(res.statusCode).to.be.equal(200);
    },
  );

  gen.registerTests(
    "permutation",
    ["name", "type"],
    ["subdomainSupport", "dohQueryType"],
    function (testCase) {
      return testCase.type === "none";
    },
    async function (testCase) {
      var { options } = testCase;
      const { res } = await commonSetup(testCase);
      if (options.ensError && options.blacklisted !== true) {
        expect(res.statusCode).to.be.equal(500);
        return;
      }
      if (options.blacklisted === true) {
        expect(res.statusCode).to.be.equal(451);
        return;
      }

      if (options.ensError) {
        expect(res.statusCode).to.be.equal(500);
        return;
      }

      if (options.ensSocialsRedirect) {
        expect(res.statusCode).to.be.equal(200);
      } else {
        expect(res.statusCode).to.be.equal(404);
      }
    },
  );

  gen.runTests(this);
  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "127.0.0.1",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(422);
  });
  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "2607:f8b0:4009:804::200e",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(422);
  });
});

describe("DoH GET API Integration Tests", function () {
  var harnessInput: HarnessType;
  var server: ProxyServer;
  var commonSetup: any; //not even the language server can figure out what this is

  beforeEach(() => {
    let r = buildAppContainer();
    server = new ProxyServer(
      r.configurationService,
      r.testLoggerService,
      r.domainQueryService,
      r.ensResolverService,
      r.testArweaveResolverService,
      r.dnsQueryService,
      r.domainRateLimit,
      r.hostnameSubstitionService,
    );
    harnessInput = r;
    commonSetup = harness(harnessInput)({ dohServerGetRequest: server });
  });

  afterEach(() => {
    harnessInput = null as any;
    server = null as any;
    commonSetup = null as any;
  });

  function handleBlacklistBehaviorTest(
    testCase: TestCaseType & { options: Options },
    res: Response,
    result: any,
  ) {
    if (testCase.options.blacklisted === "throws") {
      expect(res.statusCode).to.be.equal(200);
    } else {
      if (res.statusCode === 451) {
        //FIXME: this 451 clause shouldn't exist, this is just to describe current behavior
        expect(res.statusCode).to.be.equal(451);
        return;
      } else {
        expect(res.statusCode).to.be.equal(200);
        const payload = JSON.parse(result as string);
        expect(Math.abs(payload.Status)).to.be.equal(0);
        expect(payload.Answer).to.be.be.instanceOf(Array);
        expect(payload.Answer).to.be.empty;
      }
    }
  }

  gen.registerTests(
    "normal blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "ensError", "subdomainSupport"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        testCase.options.blacklisted === "throws"
      );
    },
    async function (testCase) {
      const { _result, res } = await commonSetup(testCase);
      handleBlacklistBehaviorTest(testCase, res, _result);
    },
  );

  gen.registerTests(
    "subdomain blacklist behavior",
    ["name", "type"],
    ["ensSocialsRedirect", "ensError", "subdomainSupport"],
    function (testCase) {
      return (
        testCase.options.blacklisted === true ||
        testCase.options.blacklisted === "throws"
      );
    },
    async function (originalTestCase) {
      const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
      for (const subdomain of subdomains) {
        var testCase = { ...originalTestCase };
        testCase.name = subdomain + "." + originalTestCase.name;
        if (originalTestCase.options.blacklisted === "throws") {
          //if the service errors, we want to be unavailable
          harnessInput.testDomainQuerySuperagentService.error = true;
        } else {
          harnessInput.testDomainQuerySuperagentService.setBlacklist(
            originalTestCase.name,
            true,
          );
        }
        const fudge = { ...testCase };
        fudge.options = { ...testCase.options, blacklisted: false }; //we don't want the subdomain blacklisted, just the original domain

        const { _result, res } = await commonSetup(fudge);
        handleBlacklistBehaviorTest(testCase, res, _result);
      }
    },
  );

  gen.registerTests(
    "permutation",
    ["name", "type"],
    ["ensSocialsRedirect", "subdomainSupport"],
    function () {
      return true;
    },
    async function (testCase) {
      var { options, type } = testCase;
      const { res, _result } = await commonSetup(testCase);
      const request = {
        trace_id: "TEST_TRACE_ID",
      };
      const contentHash = recalculateIpnsContentHash(
        request,
        type,
        testCase.contentHash,
        harnessInput,
        testCase.name,
      );

      /*
            DoH should *not* respect the server being hosted at an endpoint, it is for raw ENS queries only
        */
      if (testCase.name.endsWith("local")) {
        expect(res.statusCode).to.be.equal(200);
        const ret = JSON.parse(_result);
        expect(Math.abs(ret.Status)).to.be.equal(0);
        expect(ret.Answer).to.be.be.instanceOf(Array);
        expect(ret.Answer).to.be.empty;
        return;
      }

      if (options.blacklisted === true) {
        expect(res.statusCode).to.be.equal(451);
        return;
      }

      if (options.ensError && options.dohQueryType === "TXT") {
        expect(res.statusCode).to.be.equal(200);
        const ret = JSON.parse(_result);
        expect(Math.abs(ret.Status)).to.be.equal(2);
        return;
      }

      const result = JSON.parse(_result as string);
      expect(res.statusCode).to.be.equal(200);
      expect(Math.abs(result.Status)).to.be.equal(0);
      expect(result.Answer).to.be.be.instanceOf(Array);
      if (options.dohQueryType === "TXT") {
        if (type === "none") {
          expect(result.Answer).to.be.empty;
          return;
        }
        expect(result.Answer).to.not.be.empty;
        const the_result = result.Answer[0];
        expect(the_result.type).to.be.equal(16);
        expect(the_result.name).to.be.equal(
          harnessInput.hostnameSubstitionService.substituteHostname(
            testCase.name,
          ),
        );
        const prefix =
          type === "arweave" ? `ar://` : `/${getDnslinkPrefixFromType(type)}/`;
        const dnslink_string = `dnslink=${prefix}${contentHash?.substring(contentHash.indexOf("://") + 3)}`;
        expect(the_result.data).to.be.equal(dnslink_string);
        //if the default test configuration service was changed, this should be too
        expect(the_result.ttl).to.be.equal(69);
      } else {
        expect(result.Answer).to.be.empty;
      }
    },
  );

  gen.runTests(this);
  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "127.0.0.1",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(200);
  });

  it("should handle IP addresses correctly", async () => {
    const { res } = await commonSetup({
      name: "2607:f8b0:4009:804::200e",
      type: "none",
      additionalInfo: {},
      contentHash: null,
      options: populateDefaultOptions({
        ignoreTotalityError: true,
      }),
    });
    expect(res.statusCode).to.be.equal(200);
  });

  it("should handle long IPFS ens names", async () => {
    const { _result } = await commonSetup({
      name: "vitalik.jsonapi.eth",
      type: "ipfs",
      additionalInfo: {},
      contentHash:
        "ipfs://bagaaiaf4af5se33lei5hi4tvmuwce5djnvsseorcge3timzqgy4dknzzeiwceytmn5rwwir2eizdemjtg42denjcfqrgk4tdei5dalbcovzwk4rchj5seylemrzgk43tei5cemdymq4giqjwijddenrzgy2gcrrziq3wkrlehfstam2fguztimjviqztoykbhe3danbveiwce3tbnvsseorcozuxiylmnfvs4zlunarcyitcmfwgc3tdmurduirvgizc4nrsgq2teobcfqrha4tjmnsseorcgiydenzogm4tenzugirh27i",
      options: populateDefaultOptions({
        subdomainSupport: true,
        dohQueryType: "TXT",
      }),
    });
    const result = JSON.parse(_result);
    const reply = result.Answer[0];
    expect(reply.name).to.equal("vitalik.jsonapi.eth");
    expect(reply.data).to.equal(
      "dnslink=/ipfs/bagaaiaf4af5se33lei5hi4tvmuwce5djnvsseorcge3timzqgy4dknzzeiwceytmn5rwwir2eizdemjtg42denjcfqrgk4tdei5dalbcovzwk4rchj5seylemrzgk43tei5cemdymq4giqjwijddenrzgy2gcrrziq3wkrlehfstam2fguztimjviqztoykbhe3danbveiwce3tbnvsseorcozuxiylmnfvs4zlunarcyitcmfwgc3tdmurduirvgizc4nrsgq2teobcfqrha4tjmnsseorcgiydenzogm4tenzugirh27i",
    );
    expect(reply.type).to.equal(16);
  });
});

function getCodecFromType(type: "ipfs" | "ipns" | "arweave" | "swarm"): string {
  if (type === "ipfs") {
    return "ipfs-ns";
  } else if (type === "ipns") {
    return "ipns-ns";
  } else if (type === "arweave") {
    return "arweave-ns";
  } else if (type === "swarm") {
    return "swarm";
  }
  return type as never;
}

function recalculateIpnsContentHash(
  request: IRequestContext,
  type: string,
  contentHash: string | undefined,
  harnessInput: HarnessType,
  name: string,
) {
  if (type === "ipns" && contentHash) {
    const peerId =
      getPeerId(
        request,
        harnessInput.testLoggerService,
        contentHash.substring(7),
        name,
      ) || "THIS_SHOULD_NOT_BE_NULL";
    return "ipns://" + peerId;
  }
  return contentHash;
}

function getDnslinkPrefixFromType(
  type: "ipfs" | "ipns" | "arweave" | "swarm",
): string {
  if (type === "ipfs") {
    return "ipfs";
  } else if (type === "ipns") {
    return "ipns";
  } else if (type === "arweave") {
    return "ar";
  } else if (type === "swarm") {
    return "bzz";
  }
  return type as never;
}

function createRequestEnsureTotality(
  payload: HarnessProxyServerPayloadType,
  name: string,
  options: Options,
): RequestOptions {
  if (isProxyServerPayloadType(payload)) {
    return {
      method: "GET" as RequestMethod,
      url: "localhost",
      headers: {
        Host: name,
      },
    };
  } else if (isCaddyServerPayloadType(payload)) {
    return {
      method: "GET" as RequestMethod,
      url: `http://localhost`,
      headers: {
        Host: "localhost",
      },
      query: {
        domain: name,
      },
    };
  } else if (isDohServerGetPayloadType(payload)) {
    return {
      method: "GET" as RequestMethod,
      url: `http://localhost`,
      headers: {
        Host: "localhost",
      },
      query: {
        name,
        type: options.dohQueryType,
      },
    };
  } else {
    return payload as never;
  }
}

async function callPayloadEnsureTotality(
  payload: HarnessProxyServerPayloadType,
  req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>,
  res: Response<any, Record<string, any>>,
): Promise<void> {
  if (isProxyServerPayloadType(payload)) {
    await payload.proxyServer.proxyServer(req, res);
  } else if (isCaddyServerPayloadType(payload)) {
    await payload.caddyServer.caddy(req, res);
  } else if (isDohServerGetPayloadType(payload)) {
    await payload.dohServerGetRequest._DnsQuery.dnsqueryGet(req, res);
  } else {
    return payload as never;
  }
}
