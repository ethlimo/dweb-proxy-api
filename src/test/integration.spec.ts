import "reflect-metadata"
import { describe } from 'mocha';
import { expect } from 'chai';
// @ts-ignore //bug with parsing the type assertion
import cases from './cases.json' assert { type: "json" };
import {Server as ProxyServer} from '../server/index'
import {HarnessType, buildAppContainer} from "./helper/index";
import {RequestMethod, RequestOptions, createRequest, createResponse} from "node-mocks-http"
import { getPeerId } from "../services/EnsResolverService";
import { DITYPES } from "../dependencies/types";
import { TestRunner, cartesianProduct } from "./TestCaseGenerator";
import EventEmitter from "events";
import { Request, Response } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { TestLoggerService } from "../services/LoggerService";
import { normalizeUrlFragmentForIpfsSubdomainGateway } from "../services/EnsResolverService/utils";
import { TestLaggyRedisClientProxy } from "../services/CacheService";
import { IRequestContext } from "../services/lib";
import { TestResolverService } from "./TestResolverService";

type TestCaseType = {
    name: string,
    type: "ipfs" | "ipns" | "arweave" | "swarm" | "none",
    contentHash?: string,
    additionalInfo: Partial<{
        arweave: {
            result: string,
            query: string,
            subdomain_sandbox_id: string,
        };
    }>
}

interface Options {
    subdomainSupport: boolean,
    ensSocialsRedirect: boolean,
    blacklisted: boolean | 'throws',
    dohQueryType: "A" | "AAAA" | "CNAME" | "TXT",
    ensError: boolean | 'throws',
    redisIsLaggy: boolean,
}
const possibleOptions:Options[] = cartesianProduct({subdomainSupport: [true, false], ensSocialsRedirect: [true, false], blacklisted: [true, false, 'throws'], dohQueryType: ["A", "AAAA", "CNAME", "TXT"], ensError: [false, 'throws'], redisIsLaggy: [false, true]}) as any as Options[];
var testCases = (cases as TestCaseType[]).map((testCase) => {
    return possibleOptions.map((options) => {
        return {
            ...testCase,
            options
        }
    })
}).flatMap((x) => x);
const gen = new TestRunner(testCases);

type HarnessProxyServerPayloadType = {
    proxyServer: ProxyServer;
} | {
    caddyServer: ProxyServer;
} | {
    dohServerGetRequest: ProxyServer;
}

function isProxyServerPayloadType(payload: any): payload is {proxyServer: ProxyServer} {
    return payload.proxyServer !== undefined;
}

function isCaddyServerPayloadType(payload: any): payload is {caddyServer: ProxyServer} {
    return payload.caddyServer !== undefined;
}

function isDohServerGetPayloadType(payload: any): payload is {dohServer: ProxyServer} {
    return payload.dohServerGetRequest !== undefined;
}

type HarnessPayloadType = HarnessProxyServerPayloadType;

const harness = (harnessInput: HarnessType) => (payload: HarnessPayloadType) =>
    async (v:TestCaseType&{options: Options}) => 
    {
        var {type, contentHash, additionalInfo, options} = v;

        if(options.redisIsLaggy) {
            harnessInput.testRedisClient.setProxy(new TestLaggyRedisClientProxy());
        }

        harnessInput.testConfigurationService.set((conf) => {
            conf.ipfs.subdomainSupport = options.subdomainSupport;
            conf.ens.socialsEndpointEnabled = options.ensSocialsRedirect;
        })
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

        const nameResolvedToEnsName = harnessInput.hostnameSubstitionService.substituteHostname(v.name);
        const nameFromHostMayReferToSubdomainOfHostedProxyAddress = v.name;

        var testEnsEnsServiceExpectedValue : string | null | {error: true | 'throws', reason: string} | undefined = contentHash;
        if(options.ensError) {
            testEnsEnsServiceExpectedValue = {error: options.ensError, reason: "test"};

        }

        const resolvers = [harnessInput.testEnsService, harnessInput.web3NameSdkService];

        var theRealTestResolverService: TestResolverService;

        if(nameResolvedToEnsName.endsWith("eth")) {
            theRealTestResolverService = harnessInput.testEnsService;
        } else if (nameResolvedToEnsName.endsWith("gno")) {
            theRealTestResolverService = harnessInput.web3NameSdkService;
        } else {
            throw "Test case non-totality error"
        }

        if(testEnsEnsServiceExpectedValue !== undefined) {
            theRealTestResolverService.set(nameResolvedToEnsName, testEnsEnsServiceExpectedValue);
        }

        //poison the other resolvers to ensure our factory selects the correct one
        resolvers.filter((resolver) => resolver !== theRealTestResolverService).forEach((resolver) => {
            if(testEnsEnsServiceExpectedValue === undefined) {
                resolver.set(nameResolvedToEnsName, "ASDFASDDFASDHDAHD bad value");
            } else {
                //implicit poisoning, undefined is the default
            }
        });

        if(additionalInfo.arweave) {
            harnessInput.testArweaveResolverService.set(additionalInfo.arweave.query, additionalInfo.arweave.result);
        }
        if(options.blacklisted) {
            if(options.blacklisted === 'throws') {
                //if the service errors, we want to be unavailable
                harnessInput.testDomainQuerySuperagentService.error = true;
            } else {
                harnessInput.testDomainQuerySuperagentService.setBlacklist(nameResolvedToEnsName, true);
            }
        }
        const request = createRequestEnsureTotality(payload, nameFromHostMayReferToSubdomainOfHostedProxyAddress, options);
        const req = createRequest(request);
        const res = createResponse({
            eventEmitter: EventEmitter
        });
        var busyWaiting = true;
        res.on('end', () => {
            busyWaiting = false;
        });
        await callPayloadEnsureTotality(payload, req, res);
        while(busyWaiting) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const _result = res._getData();
        if(!res._isEndCalled()) {
            throw "Response not ended";
        }
        const content_location = res.getHeader("x-content-location");
        const content_path = res.getHeader("x-content-path");
        const content_storage_type = res.getHeader("x-content-storage-type")

        return {
            _result,
            res,
            content_location,
            content_path,
            content_storage_type
        }
}

describe('Proxy API Integration Tests', function () {
    var harnessInput: HarnessType;
    var server: ProxyServer;
    var commonSetup: any; //not even the language server can figure out what this is

    beforeEach(() => {
        let r = buildAppContainer();
        r.AppContainer.bind<ProxyServer>(ProxyServer).to(ProxyServer).inSingletonScope();
        server = r.AppContainer.get(ProxyServer);
        harnessInput = r;
        commonSetup = harness(harnessInput)({proxyServer: server})
    });

    afterEach(() => {
        harnessInput.AppContainer.unbindAll();
        harnessInput = null as any;
        server = null as any;
        commonSetup = null as any;
    });

    gen.registerTests("normal blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "dohQueryType"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws';   
    }, async function(testCase) {
        var {type, name, contentHash, options} = testCase

        const { _result, res } = await commonSetup(testCase);

        if(options.blacklisted === 'throws') {
            var expectedResponseCode = 200;
            if(options.ensError) {
                expectedResponseCode = 500;
            } else if(testCase.type === "none" && !options.ensSocialsRedirect) {
                expectedResponseCode = 404;
            }
            expect(res.statusCode).to.be.equal(expectedResponseCode);
        } else {
            expect(res.statusCode).to.be.equal(451);
        }
    });

    gen.registerTests("subdomain blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "dohQueryType"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws';   
    }, async function(originalTestCase) {
        const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
        for (const subdomain of subdomains) {

            var testCase = {...originalTestCase};
            testCase.name = subdomain + "." + originalTestCase.name;
            if(originalTestCase.options.blacklisted === 'throws') {
                //if the service errors, we want to be unavailable
                harnessInput.testDomainQuerySuperagentService.error = true;
            } else {
                harnessInput.testDomainQuerySuperagentService.setBlacklist(harnessInput.hostnameSubstitionService.substituteHostname(originalTestCase.name), true);
            }
            const fudge = JSON.parse(JSON.stringify(testCase));
            fudge.options.blacklisted = false; //we don't want the subdomain blacklisted, just the original domain

            const { _result, res } = await commonSetup(fudge);

            var {options} = testCase
            if(options.blacklisted === 'throws') {
                var expectedResponseCode = 200;
                if(options.ensError) {
                    expectedResponseCode = 500;
                } else if(testCase.type === "none" && !options.ensSocialsRedirect) {
                    expectedResponseCode = 404;
                }
                expect(res.statusCode).to.be.equal(expectedResponseCode, `subdomain: ${subdomain}`);
            } else {
                
                expect(res.statusCode).to.be.gt(399, `subdomain: ${subdomain}`);
            }
        }
    });

    gen.registerTests("x-content-location and x-content-path", ["name", "type"],["ensSocialsRedirect", "dohQueryType"], function(testCase) {
        return testCase.type === "ipfs" || testCase.type === "ipns";
    },async function(testCase) {
        var {type, name, contentHash, options} = testCase
        const { _result, content_location, content_path, content_storage_type, res } = await commonSetup(testCase);
        if(options.blacklisted === true) {
            expect(res.statusCode).to.be.equal(451);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        const request = {
            trace_id: "TEST_TRACE_ID",
        }

        contentHash = recalculateIpnsContentHash(request, type, contentHash, harnessInput, name);
        if (options.subdomainSupport) {
            expect(content_path).to.be.equal(`/`);
            let fragment = contentHash?.substring(7);
            //see the en.wikipedia-on-ipfs.org testcase
            if(type === "ipns") {
                fragment = fragment && normalizeUrlFragmentForIpfsSubdomainGateway(fragment);
            }
            expect(content_location).to.be.equal(`${fragment}.${type}.ipfs`);
        } else {
            expect(content_path).to.be.equal(`/${type}/${contentHash?.substring(7)}/`)
            expect(content_location).to.be.equal("ipfs")
        }
        expect(content_storage_type).to.be.equal(getCodecFromType(testCase.type as any));
    });
    gen.registerTests("x-content-location and x-content-path", ["name", "type"],["ensSocialsRedirect", "subdomainSupport", "dohQueryType"], function(testCase) {
        return testCase.type === "arweave";
    },async function(testCase) {
        var {type, name, contentHash, additionalInfo, options} = testCase
        const { _result, content_location, content_path, content_storage_type, res } = await commonSetup(testCase);
        if(options.blacklisted === true) {
            expect(res.statusCode).to.be.equal(451);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        expect(res.statusCode).to.be.equal(200);
        const ar_id = contentHash?.substring('arweave://'.length);
        expect(content_path).to.be.equal('/' + ar_id + '/');
        expect(additionalInfo.arweave?.subdomain_sandbox_id).to.not.be.undefined; //this would be a bad test case if it was
        expect(content_location).to.be.equal(`${additionalInfo.arweave?.subdomain_sandbox_id}.arweave`);
        expect(content_storage_type).to.be.equal(getCodecFromType(testCase.type as any));
    });
    gen.registerTests("x-content-location and x-content-path", ["name", "type"],["ensSocialsRedirect", "subdomainSupport", "dohQueryType"], function(testCase) {
        return testCase.type === "swarm";
    },async function(testCase) {
        var {type, name, contentHash, options} = testCase
        const { _result, content_location, content_path, content_storage_type, res } = await commonSetup(testCase);
        if(options.blacklisted === true) {
            expect(res.statusCode).to.be.equal(451);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }

        expect(res.statusCode).to.be.equal(200);
        expect(content_path).to.be.equal('/bzz/' + contentHash?.substring('bzz://'.length) + '/');
        expect(content_location).to.be.equal("swarm");
        expect(content_storage_type).to.be.equal(getCodecFromType(testCase.type as any));
    });
    gen.registerTests("x-content-location and x-content-path", ["name", "type"],["subdomainSupport", "blacklisted", "dohQueryType"], function(testCase) {
        return testCase.type === "none";
    },async function(testCase) {
        var {type, name, contentHash, options} = testCase
        const { _result, content_location, content_path, content_storage_type, res } = await commonSetup(testCase);
        
        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
            expect(content_storage_type).to.be.undefined;
            return;
        }
        
        if(options.ensSocialsRedirect) {
            expect(res.statusCode).to.be.equal(200);
            expect(content_path).to.be.equal(`/?name=${name}/`);
            expect(content_location).to.be.equal("socials.com");
        } else {
            expect(res.statusCode).to.be.equal(404);
            expect(content_path).to.be.undefined;
            expect(content_location).to.be.undefined;
        }

        expect(content_storage_type).to.be.undefined;
    });
    
    gen.runTests(this);
});

describe('Caddy API Integration Tests', function () {
    var harnessInput: HarnessType;
    var server: ProxyServer;
    var commonSetup: any; //not even the language server can figure out what this is

    beforeEach(() => {
        let r = buildAppContainer();
        r.AppContainer.bind<ProxyServer>(ProxyServer).to(ProxyServer).inSingletonScope();
        server = r.AppContainer.get(ProxyServer);
        harnessInput = r;
        commonSetup = harness(harnessInput)({caddyServer: server})
    });

    afterEach(() => {
        harnessInput.AppContainer.unbindAll();
        harnessInput = null as any;
        server = null as any;
        commonSetup = null as any;
    });

    gen.registerTests("normal blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "dohQueryType"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws';   
    }, async function(testCase) {
        var {type, name, contentHash, options} = testCase

        const { _result, res } = await commonSetup(testCase);

        if(options.blacklisted === 'throws') {
            var expectedResponseCode = 200;
            if(options.ensError) {
                expectedResponseCode = 500;
            } else if(testCase.type === "none" && !options.ensSocialsRedirect) {
                expectedResponseCode = 404;
            }
            expect(res.statusCode).to.be.equal(expectedResponseCode);
        } else {
            expect(res.statusCode).to.be.equal(451);
        }
    });

    gen.registerTests("subdomain blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "dohQueryType", "subdomainSupport"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws' && testCase.type !== "none";   
    }, async function(originalTestCase) {
        const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
        for (const subdomain of subdomains) {

            var testCase = JSON.parse(JSON.stringify(originalTestCase));
            testCase.name = subdomain + "." + originalTestCase.name;
            if(originalTestCase.options.blacklisted === 'throws') {
                //if the service errors, we want to be unavailable
                harnessInput.testDomainQuerySuperagentService.error = true;
            } else {
                harnessInput.testDomainQuerySuperagentService.setBlacklist(harnessInput.hostnameSubstitionService.substituteHostname(originalTestCase.name), true);
            }
            const fudge = JSON.parse(JSON.stringify(testCase));
            
            fudge.options.blacklisted = false; //we don't want the subdomain blacklisted, just the original domain

            const { _result, res } = await commonSetup(fudge);

            var {options} = testCase
            if(options.blacklisted === "throws" && options.ensError !== "throws") {
                expect(res.statusCode).to.be.equal(200);
                return;
            }

            if(res.statusCode === 200) {
                (harnessInput.AppContainer.get(DITYPES.LoggerService) as any).logMessages()
            }

            expect(res.statusCode).to.be.greaterThan(399);
        }
    });

    gen.registerTests("permutation", ["name", "type"],["subdomainSupport", "dohQueryType"], function(testCase) {
        return testCase.type === "ipfs" || testCase.type === "ipns" || testCase.type === "arweave" || testCase.type === "swarm";
    },async function(testCase) {
        var {type, name, contentHash, options} = testCase
        const { res } = await commonSetup(testCase);
        if(options.ensError && options.blacklisted !== true) {
            expect(res.statusCode).to.be.equal(500);
            return;
        }
        if(options.blacklisted) {
            if(options.blacklisted === 'throws') {
                expect(res.statusCode).to.be.equal(200);
            } else {
                expect(res.statusCode).to.be.equal(451);
            }
            return;
        }
        
        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            return;
        }
        
        expect(res.statusCode).to.be.equal(200);
    });

    gen.registerTests("permutation", ["name", "type"],["subdomainSupport", "dohQueryType"], function(testCase) {
        return testCase.type === "none";
    },async function(testCase) {
        var {type, name, contentHash, options} = testCase
        const { _result, content_location, content_path, res } = await commonSetup(testCase);
        if(options.ensError && options.blacklisted !== true) {
            (harnessInput.AppContainer.get(DITYPES.LoggerService) as TestLoggerService).logMessages()
            expect(res.statusCode).to.be.equal(500);
            return;
        }
        if(options.blacklisted === true) {
            expect(res.statusCode).to.be.equal(451);
            return;
        }

        if(options.ensError) {
            expect(res.statusCode).to.be.equal(500);
            return;
        }

        if(options.ensSocialsRedirect) {
            expect(res.statusCode).to.be.equal(200);
        } else {
            expect(res.statusCode).to.be.equal(404);
        }
    });
    
    gen.runTests(this);
});


describe('DoH GET API Integration Tests', function () {
    var harnessInput: HarnessType;
    var server: ProxyServer;
    var commonSetup: any; //not even the language server can figure out what this is

    beforeEach(() => {
        let r = buildAppContainer();
        r.AppContainer.bind<ProxyServer>(ProxyServer).to(ProxyServer).inSingletonScope();
        server = r.AppContainer.get(ProxyServer);
        harnessInput = r;
        commonSetup = harness(harnessInput)({dohServerGetRequest: server})
    });

    afterEach(() => {
        harnessInput.AppContainer.unbindAll();
        harnessInput = null as any;
        server = null as any;
        commonSetup = null as any;
    });

    function handleBlacklistBehaviorTest(testCase: TestCaseType&{options: Options}, res: Response, result: any) {
        if(testCase.options.blacklisted === 'throws') {
            expect(res.statusCode).to.be.equal(200);
        } else {
            if(res.statusCode === 451) {
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

    gen.registerTests("normal blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "ensError", "subdomainSupport"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws';   
    }, async function(testCase) {
        const { _result, res } = await commonSetup(testCase);
        handleBlacklistBehaviorTest(testCase, res, _result);
    });

    gen.registerTests("subdomain blacklist behavior", ["name", "type"], ["ensSocialsRedirect", "ensError", "subdomainSupport"], function(testCase) {
        return testCase.options.blacklisted === true || testCase.options.blacklisted === 'throws';   
    }, async function(originalTestCase) {
        const subdomains = ["asdf", "www", "a.b.c", "asdf.gsdh"];
        for (const subdomain of subdomains) {

            var testCase = {...originalTestCase};
            testCase.name = subdomain + "." + originalTestCase.name;
            if(originalTestCase.options.blacklisted === 'throws') {
                //if the service errors, we want to be unavailable
                harnessInput.testDomainQuerySuperagentService.error = true;
            } else {
                harnessInput.testDomainQuerySuperagentService.setBlacklist(originalTestCase.name, true);
            }
            const fudge = {...testCase};
            fudge.options = {...(testCase.options), blacklisted: false}; //we don't want the subdomain blacklisted, just the original domain

            const { _result, res } = await commonSetup(fudge);
            handleBlacklistBehaviorTest(testCase, res, _result);
        }
    });

    gen.registerTests("permutation", ["name", "type"],["ensSocialsRedirect", "subdomainSupport"], function(testCase) {
        return true;
    },async function(testCase) {
        var {options, type} = testCase
        const { res, _result } = await commonSetup(testCase);
        const request = {
            trace_id: "TEST_TRACE_ID",
        }
        const contentHash = recalculateIpnsContentHash(request, type, testCase.contentHash, harnessInput, testCase.name);

        /*
            DoH should *not* respect the server being hosted at an endpoint, it is for raw ENS queries only
        */
        if(testCase.name.endsWith("local")) {
            expect(res.statusCode).to.be.equal(200);
            const ret = JSON.parse(_result);
            expect(Math.abs(ret.Status)).to.be.equal(0);
            expect(ret.Answer).to.be.be.instanceOf(Array);
            expect(ret.Answer).to.be.empty;
            return;
        }

        if(options.blacklisted === true) {
            expect(res.statusCode).to.be.equal(451);
            return;
        }

        if(options.ensError && options.dohQueryType === "TXT") {
            expect(res.statusCode).to.be.equal(200);
            const ret = JSON.parse(_result);
            expect(Math.abs(ret.Status)).to.be.equal(2);
            return;
        }

        const result = JSON.parse(_result as string);
        expect(res.statusCode).to.be.equal(200);
        expect(Math.abs(result.Status)).to.be.equal(0);
        expect(result.Answer).to.be.be.instanceOf(Array);
        if(options.dohQueryType === "TXT") {
            if(type === "none") {
                expect(result.Answer).to.be.empty;
                return;
            }
            expect(result.Answer).to.not.be.empty;
            const the_result = result.Answer[0];
            expect(the_result.type).to.be.equal(16);
            expect(the_result.name).to.be.equal(harnessInput.hostnameSubstitionService.substituteHostname(testCase.name));
            const prefix = type === "arweave" ? `ar://` : `/${getDnslinkPrefixFromType(type)}/`;
            const dnslink_string = `dnslink=${prefix}${contentHash?.substring(contentHash.indexOf("://") + 3)}`;
            expect(the_result.data).to.be.equal(dnslink_string);
            //if the default test configuration service was changed, this should be too
            expect(the_result.ttl).to.be.equal(69);
        } else {
            expect(result.Answer).to.be.empty;
        }
    });
    
    gen.runTests(this);
});

function getCodecFromType(type: "ipfs" | "ipns" | "arweave" | "swarm"):string {
    if(type === "ipfs") {
        return "ipfs-ns";
    } else if(type === "ipns") {
        return "ipns-ns";
    } else if(type === "arweave") {
        return "arweave-ns";
    } else if(type === "swarm") {
        return "swarm";
    }
    return type as never
}

function recalculateIpnsContentHash(request: IRequestContext, type: string, contentHash: string | undefined, harnessInput: HarnessType, name: string) {
    if (type === "ipns" && contentHash) {
        const peerId = getPeerId(request, harnessInput.AppContainer.get(DITYPES.LoggerService), contentHash.substring(7), name) || "THIS_SHOULD_NOT_BE_NULL";
        return "ipns://" + peerId;
    }
    return contentHash;
}

function getDnslinkPrefixFromType(type: "ipfs" | "ipns" | "arweave" | "swarm"):string {
    if(type === "ipfs") {
        return "ipfs";
    } else if(type === "ipns") {
        return "ipns";
    } else if(type === "arweave") {
        return "ar";
    } else if(type === "swarm") {
        return "bzz";
    }
    return type as never
}

function createRequestEnsureTotality(payload: HarnessProxyServerPayloadType, name: string, options:Options):RequestOptions {
    if (isProxyServerPayloadType(payload)) {
        return {
            method: 'GET' as RequestMethod,
            url: "localhost",
            headers: {
                'Host': name,
            },
        };
    } else if (isCaddyServerPayloadType(payload)) {
        return {
            method: 'GET' as RequestMethod,
            url: `http://localhost`,
            headers: {
                'Host': "localhost",
            },
            query: {
                domain: name
            }
        };
    } else if (isDohServerGetPayloadType(payload)) {
        return {
            method: 'GET' as RequestMethod,
            url: `http://localhost`,
            headers: {
                'Host': "localhost",
            },
            query: {
                name,
                type: options.dohQueryType
            }
        };
    } else {
        return payload as never;
    }
}

async function callPayloadEnsureTotality(payload: HarnessProxyServerPayloadType, req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>, res: Response<any, Record<string, any>>):Promise<void> {
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
