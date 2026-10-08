import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./http-json-runtime.ts";

const base = {
  providerName: "Example",
  baseUrl: "https://api.example.com",
  path: "/items",
};

describe("requestJson", () => {
  it("reports an aborted request as a timeout", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    await expect(requestJson({ ...base, fetcher })).rejects.toMatchObject({
      status: 504,
      message: "Example request timed out",
    });
  });

  it("reports a request aborted through its signal as a timeout", async () => {
    const controller = new AbortController();
    const reason = new Error("runtime shutting down");
    controller.abort(reason);
    const fetcher = vi.fn(async () => {
      throw reason;
    });

    await expect(requestJson({ ...base, fetcher, signal: controller.signal })).rejects.toMatchObject({
      status: 504,
      message: "Example request timed out",
    });
  });

  it("keeps a non-abort transport failure as a provider error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    await expect(requestJson({ ...base, fetcher })).rejects.toMatchObject({
      status: 502,
      message: "Example request failed: socket hang up",
    });
  });
});
