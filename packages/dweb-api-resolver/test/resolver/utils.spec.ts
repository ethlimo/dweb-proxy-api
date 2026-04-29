import { describe, it } from "mocha";
import { expect } from "chai";
import {
  extractExplicitPort,
  constructUrlWithPort,
} from "../../src/resolver/utils.js";

describe("extractExplicitPort", () => {
  describe("Regular URLs with ports", () => {
    it("should extract port from HTTPS URL with default port", () => {
      const result = extractExplicitPort("https://example.com:443");
      expect(result).to.equal("443");
    });

    it("should extract port from HTTPS URL with non-default port", () => {
      const result = extractExplicitPort("https://example.com:8443");
      expect(result).to.equal("8443");
    });

    it("should extract port from HTTP URL with default port", () => {
      const result = extractExplicitPort("http://example.com:80");
      expect(result).to.equal("80");
    });

    it("should extract port from HTTP URL with non-default port", () => {
      const result = extractExplicitPort("http://example.com:8080");
      expect(result).to.equal("8080");
    });

    it("should extract port from URL with subdomain", () => {
      const result = extractExplicitPort("https://subdomain.example.com:9000");
      expect(result).to.equal("9000");
    });
  });

  describe("IPv6 URLs with ports", () => {
    it("should extract port from IPv6 URL", () => {
      const result = extractExplicitPort("https://[::1]:8443");
      expect(result).to.equal("8443");
    });

    it("should extract port from IPv6 URL with full address", () => {
      const result = extractExplicitPort(
        "https://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:443",
      );
      expect(result).to.equal("443");
    });

    it("should extract port from IPv6 URL with default port", () => {
      const result = extractExplicitPort("https://[::1]:443");
      expect(result).to.equal("443");
    });
  });

  describe("URLs without ports", () => {
    it("should return null for HTTPS URL without port", () => {
      const result = extractExplicitPort("https://example.com");
      expect(result).to.be.null;
    });

    it("should return null for HTTP URL without port", () => {
      const result = extractExplicitPort("http://example.com");
      expect(result).to.be.null;
    });

    it("should return null for IPv6 URL without port", () => {
      const result = extractExplicitPort("https://[::1]");
      expect(result).to.be.null;
    });
  });

  describe("URLs with paths, query parameters, and fragments", () => {
    it("should extract port from URL with path", () => {
      const result = extractExplicitPort(
        "https://example.com:443/path/to/resource",
      );
      expect(result).to.equal("443");
    });

    it("should extract port from URL with query parameters", () => {
      const result = extractExplicitPort(
        "https://example.com:8443?key=value&foo=bar",
      );
      expect(result).to.equal("8443");
    });

    it("should extract port from URL with fragment", () => {
      const result = extractExplicitPort("https://example.com:9000#section");
      expect(result).to.equal("9000");
    });

    it("should extract port from URL with path, query, and fragment", () => {
      const result = extractExplicitPort(
        "https://example.com:443/path?key=value#section",
      );
      expect(result).to.equal("443");
    });

    it("should not extract port-like digits from path", () => {
      const result = extractExplicitPort(
        "https://example.com/path:123/resource",
      );
      expect(result).to.be.null;
    });

    it("should not extract port-like digits from query parameter", () => {
      const result = extractExplicitPort("https://example.com?port:8080");
      expect(result).to.be.null;
    });

    it("should correctly handle URL with port and colon in path", () => {
      const result = extractExplicitPort("https://example.com:443/file:123");
      expect(result).to.equal("443");
    });
  });

  describe("URLs with userinfo", () => {
    it("should extract port from URL with username", () => {
      const result = extractExplicitPort("https://user@example.com:443");
      expect(result).to.equal("443");
    });

    it("should extract port from URL with username and password", () => {
      const result = extractExplicitPort("https://user:pass@example.com:8443");
      expect(result).to.equal("8443");
    });

    it("should not confuse colon in password with port separator", () => {
      const result = extractExplicitPort("https://user:pa:ss@example.com:443");
      expect(result).to.equal("443");
    });
  });

  describe("Edge cases", () => {
    it("should return null for URL without protocol separator", () => {
      const result = extractExplicitPort("example.com:443");
      expect(result).to.be.null;
    });

    it("should handle trailing slash after port", () => {
      const result = extractExplicitPort("https://example.com:443/");
      expect(result).to.equal("443");
    });

    it("should handle empty string", () => {
      const result = extractExplicitPort("");
      expect(result).to.be.null;
    });

    it("should handle URL with only protocol", () => {
      const result = extractExplicitPort("https://");
      expect(result).to.be.null;
    });
  });
});

describe("constructUrlWithPort", () => {
  describe("With null port (fallback to toString)", () => {
    it("should return url.toString() when explicitPort is null", () => {
      const url = new URL("https://example.com/path");
      const result = constructUrlWithPort(url, null);
      expect(result).to.equal("https://example.com/path");
    });

    it("should return url.toString() with query parameters when port is null", () => {
      const url = new URL("https://example.com/path?key=value");
      const result = constructUrlWithPort(url, null);
      expect(result).to.equal("https://example.com/path?key=value");
    });
  });

  describe("With explicit ports", () => {
    it("should preserve default HTTPS port 443", () => {
      const url = new URL("https://example.com");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://example.com:443/");
    });

    it("should preserve default HTTP port 80", () => {
      const url = new URL("http://example.com");
      const result = constructUrlWithPort(url, "80");
      expect(result).to.equal("http://example.com:80/");
    });

    it("should preserve non-default port", () => {
      const url = new URL("https://example.com");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://example.com:8443/");
    });

    it("should preserve port with path", () => {
      const url = new URL("https://example.com/path/to/resource");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://example.com:443/path/to/resource");
    });

    it("should preserve port with query parameters", () => {
      const url = new URL("https://example.com?key=value");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://example.com:8443/?key=value");
    });

    it("should preserve port with hash", () => {
      const url = new URL("https://example.com#section");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://example.com:443/#section");
    });

    it("should preserve port with path, query, and hash", () => {
      const url = new URL("https://example.com/path?key=value#section");
      const result = constructUrlWithPort(url, "9000");
      expect(result).to.equal(
        "https://example.com:9000/path?key=value#section",
      );
    });
  });

  describe("IPv6 address handling", () => {
    it("should bracket IPv6 address when adding port", () => {
      const url = new URL("https://[::1]");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://[::1]:8443/");
    });

    it("should bracket full IPv6 address when adding port", () => {
      const url = new URL("https://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]");
      const result = constructUrlWithPort(url, "443");
      // URL API normalizes IPv6 addresses to compressed form
      expect(result).to.equal("https://[2001:db8:85a3::8a2e:370:7334]:443/");
    });

    it("should handle IPv6 with path and port", () => {
      const url = new URL("https://[::1]/path");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://[::1]:8443/path");
    });

    it("should not double-bracket IPv6 addresses", () => {
      const url = new URL("https://[::1]");
      const result = constructUrlWithPort(url, "443");
      // Result should be a full URL with IPv6 address properly bracketed
      expect(result).to.equal("https://[::1]:443/");
      expect(result).to.not.match(/\[\[/);
    });
  });

  describe("Userinfo preservation", () => {
    it("should preserve username", () => {
      const url = new URL("https://user@example.com");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://user@example.com:443/");
    });

    it("should preserve username and password", () => {
      const url = new URL("https://user:pass@example.com");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://user:pass@example.com:443/");
    });

    it("should preserve userinfo with non-default port", () => {
      const url = new URL("https://user:pass@example.com");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://user:pass@example.com:8443/");
    });

    it("should preserve userinfo with path", () => {
      const url = new URL("https://user:pass@example.com/path");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://user:pass@example.com:443/path");
    });

    it("should preserve username without password", () => {
      const url = new URL("https://user@example.com/path");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://user@example.com:8443/path");
    });
  });

  describe("Complex scenarios", () => {
    it("should handle IPv6 with userinfo", () => {
      const url = new URL("https://user:pass@[::1]");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://user:pass@[::1]:8443/");
    });

    it("should handle IPv6 with userinfo, path, query, and hash", () => {
      const url = new URL("https://user:pass@[::1]/path?key=value#section");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal(
        "https://user:pass@[::1]:443/path?key=value#section",
      );
    });

    it("should handle subdomain with port", () => {
      const url = new URL("https://subdomain.example.com/path");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.equal("https://subdomain.example.com:443/path");
    });

    it("should handle userinfo with special characters in password", () => {
      // URL encoding happens automatically in URL constructor
      const url = new URL("https://user:p%40ss@example.com");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.include("user:p%40ss@example.com:443");
    });
  });

  describe("Protocol handling", () => {
    it("should work with HTTP protocol", () => {
      const url = new URL("http://example.com");
      const result = constructUrlWithPort(url, "8080");
      expect(result).to.equal("http://example.com:8080/");
    });

    it("should work with HTTPS protocol", () => {
      const url = new URL("https://example.com");
      const result = constructUrlWithPort(url, "8443");
      expect(result).to.equal("https://example.com:8443/");
    });

    it("should preserve protocol in output", () => {
      const url = new URL("https://example.com");
      const result = constructUrlWithPort(url, "443");
      expect(result).to.match(/^https:\/\//);
    });
  });
});
