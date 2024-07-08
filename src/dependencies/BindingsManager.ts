import { Container, interfaces } from "inversify";
import { DITYPES } from "./types";

export enum EnvironmentConfiguration {
  Production = "Production",
  Development = "Development",
  LiveDataIntegration = "LiveDataIntegration"
}
type EnvironmentBindingConfig<T> = {
  type: "class";
  theConstructor: interfaces.Newable<T>;
  notASingleton?: true; //default behavior is to be a singleton, field should only be present if binding isn't singleton
} | {
  type: "factory";
  factory: interfaces.FactoryCreator<T>;
};
interface BindingConfig<T> {
  key: keyof typeof DITYPES;
  config: {
    [K in EnvironmentConfiguration]: EnvironmentBindingConfig<T>;
  };
}
export class BindingsManager {
  private container: Container;
  private configs: ((env: EnvironmentConfiguration) => void)[] = [];
  private seenKeys: Set<keyof typeof DITYPES> = new Set();

  constructor() {
    this.container = new Container();
  }

  registerBinding<T>(bindingConfig: BindingConfig<T>) {
    if (this.seenKeys.has(bindingConfig.key)) {
      throw new Error(`Duplicate binding for ${bindingConfig.key}`);
    }
    this.configs.push((env: EnvironmentConfiguration) => {
      const config = bindingConfig.config[env];
      if (config.type === "class") {
        const binding = this.container.bind<T>(DITYPES[bindingConfig.key]).to(config.theConstructor);
        if (!config.notASingleton) {
          binding.inSingletonScope();
        }
      } else if (config.type === "factory") {
        this.container.bind<T>(DITYPES[bindingConfig.key]).toFactory(config.factory);
      }
    });
    this.seenKeys.add(bindingConfig.key);
  }

  bindAll(environment: EnvironmentConfiguration) {
    Object.keys(DITYPES).forEach((key) => {
      if (!this.seenKeys.has(key as keyof typeof DITYPES)) {
        throw new Error(`No binding for ${key}`);
      }
    });
    this.configs.forEach((config) => {
      config(environment);
    });
    return {
      container: this.container,
      environment
    };
  }
}
