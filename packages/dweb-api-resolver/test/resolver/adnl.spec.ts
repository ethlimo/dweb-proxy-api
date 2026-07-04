import { describe, it } from "mocha";
import { expect } from "chai";
import { adnlAddressToHostname } from "../../src/resolver/adnl.js";

describe("adnlAddressToHostname", () => {
  it("should encode a 32-byte ADNL address as a 55-character hostname label", () => {
    expect(
      adnlAddressToHostname(
        "61bd855da6c07e8d1c807e880c2a9a6272011cfc2b34b2e9de32cd37ff6f4ae5",
      ),
    ).to.equal("vq33bk5u3ah5di4qb7iqdbktjrheai47qvtjmxj3yzm2n77n5folewn");
  });

  it("should encode the all-zero address", () => {
    expect(
      adnlAddressToHostname(
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ).to.equal("uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaadi2");
  });

  it("should encode the all-ff address", () => {
    expect(
      adnlAddressToHostname(
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
    ).to.equal("x777777777777777777777777777777777777777777777777777cno");
  });

  it("should return null for input that is not 64 hex characters", () => {
    expect(adnlAddressToHostname("61bd855d")).to.be.null;
    expect(
      adnlAddressToHostname(
        "zzbd855da6c07e8d1c807e880c2a9a6272011cfc2b34b2e9de32cd37ff6f4ae5",
      ),
    ).to.be.null;
    expect(
      adnlAddressToHostname(
        "61bd855da6c07e8d1c807e880c2a9a6272011cfc2b34b2e9de32cd37ff6f4ae500",
      ),
    ).to.be.null;
  });
});
