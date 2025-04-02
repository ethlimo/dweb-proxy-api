import { EnvironmentConfiguration } from "./dependencies/BindingsManager.js";
import { createApplicationConfigurationBindingsManager } from "./dependencies/services.js";
import { Server } from "./server/index.js";

// Start main worker process

const services = createApplicationConfigurationBindingsManager();
const env = EnvironmentConfiguration.Production;
const server = new Server(
  services.configuration.getBinding(env),
  services.logger.getBinding(env),
  services.domainQuery.getBinding(env),
  services.ensResolver.getBinding(env),
  services.arweaveResolver.getBinding(env),
  services.dnsQuery.getBinding(env),
  services.domainRateLimit.getBinding(env),
  services.hostnameSubstitution.getBinding(env),
);

server.start();
