import { describe, expect, it } from "vitest";

import { parseDeepLink, shouldSkipDeepLinkNavigation } from "./native-deeplink";

describe("native deeplink worker portal", () => {
  it("parses worker task token and PIN from custom scheme", () => {
    expect(parseDeepLink("biz.mcmstorage.app://t/share-token-1?p=1234")).toEqual({
      token: "share-token-1",
      pin: "1234",
    });
  });

  it("skips exact same worker URL so Android redelivered intents do not remount the portal", () => {
    expect(
      shouldSkipDeepLinkNavigation(
        { pathname: "/t/share-token-1", search: "", hash: "#p=1234" },
        "/t/share-token-1",
        "p=1234",
        false,
      ),
    ).toBe(true);
  });

  it("skips same task while native picker suppression is active", () => {
    expect(
      shouldSkipDeepLinkNavigation(
        { pathname: "/t/share-token-1", search: "", hash: "" },
        "/t/share-token-1",
        "p=1234",
        true,
      ),
    ).toBe(true);
  });

  it("allows a genuinely different worker task deeplink", () => {
    expect(
      shouldSkipDeepLinkNavigation(
        { pathname: "/t/share-token-1", search: "", hash: "#p=1234" },
        "/t/share-token-2",
        "p=5678",
        true,
      ),
    ).toBe(false);
  });
});