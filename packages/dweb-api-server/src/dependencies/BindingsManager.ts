export enum EnvironmentConfiguration {
  Production = "Production",
  Development = "Development",
}

export type BindingEnvironmentConfig<T> = {
  [K in EnvironmentConfiguration]: (env: EnvironmentConfiguration) => T;
};

export class EnvironmentBinding<T> {
  private bindings: BindingEnvironmentConfig<T>;

  private cache: Map<EnvironmentConfiguration, T> = new Map();

  constructor(bindings: BindingEnvironmentConfig<T>) {
    this.bindings = bindings;
  }

  public getBinding(env: EnvironmentConfiguration): T {
    if (this.cache.has(env)) {
      return this.cache.get(env) as T;
    } else {
      const binding = this.bindings[env](env);
      this.cache.set(env, binding);
      return binding;
    }
  }
}
