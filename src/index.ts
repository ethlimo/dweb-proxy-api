import "reflect-metadata";
import { Server } from "./server/index.js";
import { createProductionAppContainer } from "./dependencies/inversify.config.js";

// Start main worker process

const AppContainer = createProductionAppContainer().container;

AppContainer.bind<Server>(Server).to(Server).inSingletonScope();
const server = AppContainer.get(Server);
server.start();