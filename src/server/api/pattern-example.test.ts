import { describe, expect, it } from "vitest";
import { samplePattern } from "./pattern-example.ts";

describe("samplePattern", () => {
  it("samples digit runs and fixed widths", () => {
    expect(samplePattern("^[0-9]+$")).toBe("0");
    expect(samplePattern("^\\d+$")).toBe("0");
    expect(samplePattern("^[0-9]{8}$")).toBe("00000000");
    expect(samplePattern("^[0-9]{3,8}$")).toBe("000");
    expect(samplePattern("^[0-9]{4}-[0-9]{4}$")).toBe("0000-0000");
    expect(samplePattern("^[0-9]{7,15}$")).toBe("0000000");
  });

  it("samples fixed-width alphanumeric identifiers", () => {
    expect(samplePattern("^[A-Z0-9]{10}$")).toBe("AAAAAAAAAA");
    expect(samplePattern("^[A-Za-z]{3}$")).toBe("AAA");
    expect(samplePattern("^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$")).toBe("22222222");
    expect(samplePattern("^(0x)?[0-9a-fA-F]{40}$")).toBe("0".repeat(40));
    expect(samplePattern("^[a-fA-F0-9]{32}$")).toBe("a".repeat(32));
    expect(samplePattern("^[A-Z0-9_]+$")).toBe("A");
  });

  it("samples date, time, and duration shapes", () => {
    expect(samplePattern("^[0-9]{4}-(0[1-9]|1[0-2])$")).toBe("0000-01");
    expect(samplePattern("^\\d{4}-\\d{2}-\\d{2}$")).toBe("0000-00-00");
    expect(samplePattern("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$")).toBe("0000-00-00 00:00:00");
    expect(samplePattern("^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$")).toBe("00:00:00");
    expect(samplePattern("^([01][0-9]|2[0-3]):[0-5][0-9]$")).toBe("00:00");
    expect(samplePattern("^[+-][0-9]{2}:[0-9]{2}$")).toBe("+00:00");
    expect(samplePattern("^(0[89]|1[0-9]|2[01]):00$")).toBe("08:00");
  });

  it("samples literals, escapes, and negated classes", () => {
    expect(samplePattern("^https://api\\.calendly\\.com/event_types/[^/]+(?:/.*)?$")).toBe(
      "https://api.calendly.com/event_types/a",
    );
    expect(samplePattern("^q=[^?#]+$")).toBe("q=a");
    expect(samplePattern("^[^:/?#]+:[0-9]{1,5}$")).toBe("a:0");
    expect(samplePattern("^prj_")).toBe("prj_");
    expect(samplePattern("^/")).toBe("/");
    expect(samplePattern("^urn:li:person:.+")).toBe("urn:li:person:a");
    expect(samplePattern("^metabase://docs/")).toBe("metabase://docs/");
  });

  it("picks the shortest alternation branch", () => {
    expect(samplePattern("^(?:id:[1-9][0-9]*|email:.*\\S.*|phone:.*\\S.*)$")).toBe("id:1");
    expect(
      samplePattern(
        "^((000[1-9]|00[1-9][0-9]|0[1-9][0-9]{2}|[1-9][0-9]{3})(-(0[1-9]|1[0-2]))?|last30days|last12months)$",
      ),
    ).toBe("0001");
    expect(samplePattern("^(https?://|data:image/[^;]+;base64,)")).toBe("http://");
    expect(samplePattern("^(0x)?[0-9a-fA-F]{40}$")).toBe("0".repeat(40));
  });

  it("samples character classes inside repeat and optional groups", () => {
    expect(samplePattern("^[a-z0-9][a-z0-9-]*[a-z0-9]$")).toBe("aa");
    expect(samplePattern("^[1-9][0-9]{6,14}$")).toBe("1000000");
    expect(samplePattern("^(sh|sz)[0-9]{6}$")).toBe("sh000000");
    expect(samplePattern("^[A-Z0-9]+(,[A-Z0-9]+){0,39}$")).toBe("A");
    expect(samplePattern("^FBA[0-9A-Z]{7,9}$")).toBe("FBA0000000");
  });

  it("grows unbounded quantifiers to the minimum length", () => {
    expect(samplePattern("^[0-9]+$", { minLength: 5 })).toBe("00000");
    expect(samplePattern("^\\d{2,}$", { minLength: 4 })).toBe("0000");
    expect(samplePattern("^[a-z]*$", { minLength: 3 })).toBe("aaa");
    expect(samplePattern("^\\d{2}$", { minLength: 4 })).toBe("00");
  });

  it("returns undefined for unsupported or invalid patterns", () => {
    expect(
      samplePattern(
        "^(?!.*://)(?!.*\\/)(?:\\\\.)?(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\\\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$",
      ),
    ).toBeUndefined();
    expect(samplePattern("^(?!https?://)[^/]+/.+")).toBeUndefined();
    expect(samplePattern("(a)\\1")).toBeUndefined();
    expect(samplePattern("^\\p{L}+$")).toBeUndefined();
    expect(samplePattern("^[a-")).toBeUndefined();
    expect(samplePattern("^a{2,1}$")).toBeUndefined();
    expect(samplePattern("[")).toBeUndefined();
  });

  it("refuses repeats that would allocate beyond the sample bound", () => {
    expect(samplePattern("^a{99999999999}$")).toBeUndefined();
    expect(samplePattern("^(?:a{100000}){100000}$")).toBeUndefined();
    expect(samplePattern("^\\d{100000000}$")).toBeUndefined();
    expect(samplePattern("^(a{600}|b)$")).toBe("b");
  });
});
