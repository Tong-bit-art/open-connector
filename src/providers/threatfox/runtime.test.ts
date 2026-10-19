import type { ThreatfoxRuntimeContext } from "./runtime.ts";

import { describe, expect, it } from "vitest";
import { ProviderRequestError } from "../provider-runtime.ts";
import { threatfoxActionHandlers } from "./runtime.ts";

function contextReturning(status: number): ThreatfoxRuntimeContext {
  return {
    apiKey: "test-key",
    fetcher: async () => new Response("rejected", { status }),
  };
}

async function mapError(status: number): Promise<ProviderRequestError> {
  const input = { ioc: "evil.example" };
  try {
    await threatfoxActionHandlers.lookup_ioc(input, contextReturning(status));
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderRequestError);
    return error as ProviderRequestError;
  }
  throw new Error(`ThreatFox lookup with HTTP ${status} did not fail`);
}

describe("ThreatFox error mapping", () => {
  it.each([401, 403])("maps HTTP %i to the owned authorization code", async (status) => {
    const error = await mapError(status);
    expect(error.status).toBe(status);
    expect(error.code).toBe("authorization_failed");
  });

  it("keeps the rate limit on rate_limited", async () => {
    expect((await mapError(429)).code).toBe("rate_limited");
  });

  it("keeps other failures on provider_error", async () => {
    expect((await mapError(500)).code).toBe("provider_error");
  });
});
