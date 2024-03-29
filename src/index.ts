import "reflect-metadata";
import { Server } from "./server/index.js";
import { AppContainer } from "./inversify.config.js";

// Start main worker process


AppContainer.bind<Server>(Server).to(Server).inSingletonScope();
const server = AppContainer.get(Server);
server.start();