import { HostnameSubstitutionConfiguration } from "dweb-api-types/dist/config";

export function parseRawConfig(
  rawConfig: string,
): HostnameSubstitutionConfiguration {
  try {
    return JSON.parse(Buffer.from(rawConfig, "base64").toString());
  } catch {
    // Fallback to plain JSON
  }
  try {
    return JSON.parse(rawConfig);
  } catch (e: any) {
    throw new Error(
      `Invalid hostname substitution configuration: ${e.message}`,
    );
  }
}
