import type { ActionDefinition, JsonSchema } from "../../core/types.ts";

import { describe, expect, it } from "vitest";
import { validateActionInput } from "../../core/validation.ts";
import { buildExampleInput } from "./action-example.ts";

const action: ActionDefinition = {
  id: "github.delete_repository",
  service: "github",
  name: "delete_repository",
  description: "Delete a repository.",
  operationType: "destructive",
  requiredScopes: [],
  providerPermissions: [],
  inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
  outputSchema: { type: "object" },
};

describe("buildExampleInput", () => {
  function expectValidExample(label: string, inputSchema: JsonSchema): Record<string, unknown> {
    const example = buildExampleInput(inputSchema);
    const result = validateActionInput({ ...action, inputSchema }, example);
    expect(result.valid, `${label}: ${JSON.stringify(example)}`).toBe(true);
    return example;
  }

  it("generates an example that satisfies the action's own input schema", () => {
    expectValidExample("minLength", {
      type: "object",
      properties: { name: { type: "string", minLength: 1 } },
      required: ["name"],
    });
    expectValidExample("pattern", {
      type: "object",
      properties: { name: { type: "string", pattern: "\\S" } },
      required: ["name"],
    });
    for (const format of ["email", "date", "date-time", "uri", "uuid", "ipv4", "ipv6"]) {
      expectValidExample(format, {
        type: "object",
        properties: { value: { type: "string", format } },
        required: ["value"],
      });
    }
    expectValidExample("minimum", {
      type: "object",
      properties: { limit: { type: "number", minimum: 5 } },
      required: ["limit"],
    });
  });

  it("generates an example that satisfies the action's structural constraints", () => {
    const nullable = expectValidExample("nullable number", {
      type: "object",
      properties: { count: { anyOf: [{ type: "number" }, { type: "null" }] } },
      required: ["count"],
    });
    expect(typeof nullable.count).toBe("number");

    const exactlyOne = expectValidExample("exactly one property", {
      type: "object",
      properties: { mermaid: { type: "string" }, xml: { type: "string" } },
      oneOf: [{ required: ["mermaid"] }, { required: ["xml"] }],
    });
    expect(Object.keys(exactlyOne)).toHaveLength(1);

    const array = expectValidExample("minItems", {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["ids"],
    });
    expect(Array.isArray(array.ids) && array.ids.length >= 1).toBe(true);

    const nested = expectValidExample("nested required", {
      type: "object",
      properties: {
        config: { type: "object", properties: { host: { type: "string", minLength: 1 } }, required: ["host"] },
      },
      required: ["config"],
    });
    expect(nested.config).toEqual(expect.objectContaining({ host: expect.any(String) }));

    const oneOfByShape = expectValidExample("oneOf shapes", {
      oneOf: [
        {
          type: "object",
          properties: { map_id: { type: "string", minLength: 1 }, project_id: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { map_id: { type: "string", minLength: 1 }, folder_id: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      ],
    });
    expect(Object.keys(oneOfByShape)).toContain("project_id");

    const allOf = expectValidExample("allOf member requirement", {
      type: "object",
      required: ["id"],
      allOf: [
        {
          oneOf: [
            { required: ["sheetId"], not: { required: ["sheetName"] } },
            { required: ["sheetName"], not: { required: ["sheetId"] } },
          ],
        },
      ],
    });
    expect("sheetId" in allOf || "sheetName" in allOf).toBe(true);

    const map = expectValidExample("additionalProperties minProperties", {
      type: "object",
      properties: { attributes: { type: "object", additionalProperties: { type: "string" }, minProperties: 1 } },
      required: ["attributes"],
    });
    expect(Object.keys(map.attributes as Record<string, unknown>).length).toBeGreaterThanOrEqual(1);
  });

  it("generates an example that satisfies tuple, bound, and discriminator constraints", () => {
    const bounded = expectValidExample("combined numeric bounds", {
      type: "object",
      properties: { value: { type: "number", minimum: 0, exclusiveMinimum: 2, maximum: 3 } },
      required: ["value"],
    });
    expect(bounded.value).toBeGreaterThan(2);

    const integer = expectValidExample("combined integer bounds", {
      type: "object",
      properties: { value: { type: "integer", minimum: 0, exclusiveMinimum: 2, maximum: 3 } },
      required: ["value"],
    });
    expect(integer.value).toBe(3);

    const tuple = expectValidExample("tuple filled to minItems", {
      type: "object",
      properties: {
        pair: { type: "array", prefixItems: [{ type: "string" }], items: { type: "string" }, minItems: 2 },
      },
      required: ["pair"],
    });
    expect((tuple.pair as unknown[]).length).toBe(2);

    const long = expectValidExample("minItems beyond the display cap", {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 5 } },
      required: ["ids"],
    });
    expect((long.ids as unknown[]).length).toBe(5);

    const longString = expectValidExample("minLength beyond the display cap", {
      type: "object",
      properties: { token: { type: "string", minLength: 100 } },
      required: ["token"],
    });
    expect((longString.token as string).length).toBe(100);

    const minProperties = expectValidExample("minProperties with named and additional properties", {
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: { type: "string" },
      minProperties: 2,
    });
    expect(Object.keys(minProperties).length).toBe(2);

    const discriminated = expectValidExample("discriminated oneOf branch", {
      type: "object",
      required: ["kind"],
      properties: { kind: { const: "folder" } },
      oneOf: [
        { required: ["fileId"], properties: { kind: { const: "file" }, fileId: { type: "string" } } },
        { required: ["folderId"], properties: { kind: { const: "folder" }, folderId: { type: "string" } } },
      ],
    });
    expect(discriminated.kind).toBe("folder");
    expect("folderId" in discriminated).toBe(true);
  });

  it("generates an example that satisfies merged allOf, format bounds, and item bounds", () => {
    const allOfProperty = expectValidExample("allOf member property constraint", {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
      allOf: [{ properties: { name: { type: "string", minLength: 1 } } }],
    });
    expect(allOfProperty.name).not.toBe("");

    const email = expectValidExample("formatted string length bounds", {
      type: "object",
      properties: { email: { type: "string", format: "email", minLength: 17, maxLength: 17 } },
      required: ["email"],
    });
    expect((email.email as string).length).toBe(17);

    const uri = expectValidExample("formatted uri minimum length", {
      type: "object",
      properties: { callback: { type: "string", format: "uri", minLength: 24 } },
      required: ["callback"],
    });
    expect((uri.callback as string).length).toBe(24);

    const scores = expectValidExample("unique numeric items with a minimum", {
      type: "object",
      properties: {
        scores: { type: "array", items: { type: "integer", minimum: 10 }, minItems: 2, uniqueItems: true },
      },
      required: ["scores"],
    });
    expect(scores.scores).toEqual([10, 11]);

    const hostname = expectValidExample("hostname with a long minimum", {
      type: "object",
      properties: { host: { type: "string", format: "hostname", minLength: 80 } },
      required: ["host"],
    });
    const labels = (hostname.host as string).split(".");
    expect(labels.every((label) => label.length <= 63)).toBe(true);
    expect((hostname.host as string).length).toBeGreaterThanOrEqual(80);

    const tags = expectValidExample("unique string items with a minimum length", {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string", minLength: 2 }, minItems: 2, uniqueItems: true } },
      required: ["tags"],
    });
    expect(tags.tags).toEqual(["aa", "bb"]);
  });

  it("satisfies sibling anyOf and oneOf requirements", () => {
    expectValidExample("both combinators", {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        html: { type: "string", minLength: 1 },
        prompt: { type: "string", minLength: 1 },
        responseFormat: { type: "object" },
      },
      oneOf: [{ required: ["url"] }, { required: ["html"] }],
      anyOf: [{ required: ["prompt"] }, { required: ["responseFormat"] }],
    });
  });

  it("selects a required-property branch without seeding forbidden optional fields", () => {
    expectValidExample("optional default branch", {
      type: "object",
      properties: { chainId: { type: "integer" }, network: { type: "string" } },
      oneOf: [
        { not: { anyOf: [{ required: ["chainId"] }, { required: ["network"] }] } },
        { required: ["chainId"], not: { required: ["network"] } },
        { required: ["network"], not: { required: ["chainId"] } },
      ],
    });
  });

  it("keeps the first anyOf object candidate when later branches require fields", () => {
    const text = { type: "object", properties: { text: { type: "string" } }, additionalProperties: false };
    expectValidExample("array with an optional-field object variant", {
      type: "object",
      properties: {
        content: {
          type: "array",
          minItems: 1,
          contains: text,
          items: { anyOf: [text, { type: "object", properties: { image: { type: "string" } }, required: ["image"] }] },
        },
      },
      required: ["content"],
    });
  });

  it("preserves nested union constraints when selecting a branch", () => {
    expectValidExample("nested anyOf", {
      type: "object",
      properties: {
        to: {
          anyOf: [
            { anyOf: [{ type: "string", minLength: 1 }, { type: "number" }] },
            { type: "array", items: { type: "string" }, minItems: 1 },
          ],
        },
      },
      required: ["to"],
    });
  });

  it("preserves object requirements inside a selected branch", () => {
    expectValidExample("nested object combinators", {
      type: "object",
      properties: {
        message: {
          type: "object",
          properties: { html: { type: "string" }, text: { type: "string" }, template: { type: "string" } },
          oneOf: [{ anyOf: [{ required: ["html"] }, { required: ["text"] }] }, { required: ["template"] }],
        },
      },
      required: ["message"],
    });
  });

  it("distinguishes nested oneOf object branches without required properties", () => {
    const example = expectValidExample("nested oneOf shapes", {
      type: "object",
      properties: {
        permission: {
          oneOf: [
            { type: "object", properties: { mode: { const: "all" } }, additionalProperties: false },
            { type: "object", properties: { mode: { const: "none" } }, additionalProperties: false },
          ],
        },
      },
      required: ["permission"],
    });
    expect(example.permission).toEqual({ mode: "all" });
  });

  it.each([true, undefined])(
    "fills open maps with minProperties when additionalProperties is %s",
    (additionalProperties) => {
      expectValidExample("open map", {
        type: "object",
        properties: { filters: { type: "object", additionalProperties, minProperties: 1 } },
        required: ["filters"],
      });
    },
  );

  it("applies absent-property conditions and nested object refinements", () => {
    const example = expectValidExample("conditional nested field", {
      type: "object",
      properties: {
        mode: { enum: ["text", "image"] },
        subject: {
          type: "object",
          properties: { name: { type: "string" }, date: { type: "string", format: "date" } },
          required: ["name"],
        },
      },
      required: ["subject"],
      allOf: [
        {
          if: { properties: { mode: { const: "text" } } },
          then: { properties: { subject: { required: ["date"], properties: { name: { minLength: 2 } } } } },
        },
      ],
    });
    expect(example.subject).toEqual({ name: "aa", date: "2000-01-01" });
  });

  it("applies else refinements to array items and numeric enums", () => {
    const example = expectValidExample("conditional array and enum", {
      type: "object",
      properties: {
        mode: { type: "string" },
        month: { type: "integer", enum: [-1, 1, 2] },
        changes: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { uri: { type: "string", minLength: 1 } } },
        },
      },
      required: ["month", "changes"],
      allOf: [
        {
          if: { required: ["mode"], properties: { mode: { const: "lunar" } } },
          else: { properties: { month: { minimum: 1 }, changes: { items: { required: ["uri"] } } } },
        },
      ],
    });
    expect(example.month).toBe(1);
    expect(example.changes).toEqual([{ uri: "a" }]);
  });

  it("seeds a conditional required field using its parent type and branch bounds", () => {
    const example = expectValidExample("conditional required field", {
      type: "object",
      properties: { message: { type: "string", maxLength: 100 } },
      if: { properties: { mode: { const: "text" } } },
      then: { required: ["message"], properties: { message: { minLength: 2 } } },
    });
    expect(example.message).toBe("aa");
  });

  it("uses propertyNames when filling a required map", () => {
    const example = expectValidExample("currency map", {
      type: "object",
      minProperties: 1,
      propertyNames: { type: "string", pattern: "^[A-Z]{3}$" },
      additionalProperties: { type: "number", minimum: 1 },
    });
    expect(example).toEqual({ AAA: 1 });
  });

  it("selects a nonempty oneOf shape when an empty object matches both branches", () => {
    const example = expectValidExample("empty and optional-field shapes", {
      oneOf: [
        { type: "object", properties: {}, additionalProperties: false },
        { type: "object", properties: { latitude: { type: "number" } }, additionalProperties: false },
      ],
    });
    expect(example).toEqual({ latitude: 1 });
  });
});
