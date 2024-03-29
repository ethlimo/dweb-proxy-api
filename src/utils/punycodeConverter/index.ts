// @ts-ignore
import punycode from "punycode/punycode.js";
/**
 *
 * @param {string} domainString
 * @returns {string}
 */
export function punycodeDomainPartsToUnicode(domainString: string) {
  return domainString
    .split(".")
    .map((x) => (x.match(/^xn--/) ? punycode.toUnicode(x) : x))
    .join(".");
}
