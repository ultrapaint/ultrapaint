import { describe, expect, it } from "vitest";
import { proxyUnder } from "./proxy.ts";

const AUTH_RE = /^\/auth/;

describe("proxyUnder", () => {
  it("keys every rule under the base, which its path is seen without", () => {
    const proxy = proxyUnder(
      {
        "/api": "http://127.0.0.1:8080",
        "^/auth/.*": {
          rewrite: (path) => path.replace(AUTH_RE, ""),
          target: "http://127.0.0.1:9000",
        },
      },
      "/preview/"
    );
    const api = proxy?.["/preview/api"];
    const auth = proxy?.["^/preview/auth/.*"];
    if (typeof api !== "object" || typeof auth !== "object") {
      throw new Error(JSON.stringify(proxy));
    }
    expect(api.target).toBe("http://127.0.0.1:8080");
    expect(api.changeOrigin).toBe(true);
    expect(api.rewrite?.("/preview/api/products")).toBe("/api/products");
    expect(auth.rewrite?.("/preview/auth/login")).toBe("/login");
  });

  it("leaves no proxy as none", () => {
    expect(proxyUnder(undefined, "/preview/")).toBeUndefined();
  });
});
