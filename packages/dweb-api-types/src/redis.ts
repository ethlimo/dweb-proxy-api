export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, duration: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  expire(key: string, duration: number): Promise<number>;
  incr(key: string): Promise<number>;
}
