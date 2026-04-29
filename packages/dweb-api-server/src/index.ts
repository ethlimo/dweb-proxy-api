import { DataUrlProxy } from "./server/DataUrlProxy.js";
import { EnvironmentConfiguration } from "./dependencies/BindingsManager.js";
import { createApplicationConfigurationBindingsManager } from "./dependencies/services.js";
import { Server } from "./server/index.js";
import { runClustered } from "./server/cluster.js";

(async () => {
  const services = await createApplicationConfigurationBindingsManager();
  const env = EnvironmentConfiguration.Production;
  const configuration = services.configuration.getBinding(env);
  const logger = services.logger.getBinding(env);
  const domainQuery = services.domainQuery.getBinding(env);
  const ensResolver = services.ensResolver.getBinding(env);
  const arweaveResolver = services.arweaveResolver.getBinding(env);
  const dnsQuery = services.dnsQuery.getBinding(env);
  const domainRateLimit = services.domainRateLimit.getBinding(env);
  const hostnameSubstitution = services.hostnameSubstitution.getBinding(env);
  const dataUriResolver = services.dataUrlResolverService.getBinding(env);

  const [
    resolvedConfiguration,
    resolvedLogger,
    resolvedDomainQuery,
    resolvedEnsResolver,
    resolvedArweaveResolver,
    resolvedDnsQuery,
    resolvedDomainRateLimit,
    resolvedHostnameSubstitution,
    resolvedDataUriResolver,
  ] = await Promise.all([
    configuration,
    logger,
    domainQuery,
    ensResolver,
    arweaveResolver,
    dnsQuery,
    domainRateLimit,
    hostnameSubstitution,
    dataUriResolver,
  ]);

  const isDataUrlEnabled =
    resolvedConfiguration.getDataUrlServerConfig().getDataUrlEnabled();
  const isRouterEnabled =
    resolvedConfiguration.getRouterConfig().getRouterEnabled();

  if (isDataUrlEnabled) {
    resolvedLogger.info("Starting Data URL Proxy Server", {
      origin: "index.ts",
      trace_id: "UNDEFINED_TRACE_ID",
      context: {},
    });
  }

  if (isRouterEnabled) {
    resolvedLogger.info("Starting Proxy Server", {
      origin: "index.ts",
      trace_id: "UNDEFINED_TRACE_ID",
      context: {},
    });
  }

  if (isDataUrlEnabled || isRouterEnabled) {
    const clusterConfig = resolvedConfiguration.getClusterConfig();
    runClustered((registerServer) => {
      if (isDataUrlEnabled) {
        const dataUrlServer = new DataUrlProxy(
          resolvedConfiguration,
          resolvedLogger,
          resolvedDomainQuery,
          resolvedEnsResolver,
          resolvedArweaveResolver,
          resolvedDnsQuery,
          resolvedDomainRateLimit,
          resolvedHostnameSubstitution,
          resolvedDataUriResolver,
        );
        dataUrlServer.start(registerServer);
      }
      if (isRouterEnabled) {
        const server = new Server(
          resolvedConfiguration,
          resolvedLogger,
          resolvedDomainQuery,
          resolvedEnsResolver,
          resolvedArweaveResolver,
          resolvedDnsQuery,
          resolvedDomainRateLimit,
          resolvedHostnameSubstitution,
          resolvedDataUriResolver,
        );
        server.start(registerServer);
      }
    }, {
      workers: clusterConfig.getWorkers(),
      maxInflight: clusterConfig.getMaxInflight(),
      maxLagMs: clusterConfig.getMaxLagMs(),
      overloadGraceMs: clusterConfig.getOverloadGraceMs(),
      noHeartbeatMs: clusterConfig.getNoHeartbeatMs(),
      catastrophicRestarts: clusterConfig.getCatastrophicRestarts(),
      catastrophicWindowMs: clusterConfig.getCatastrophicWindowMs(),
      logger: resolvedLogger,
    });
  }
})();
