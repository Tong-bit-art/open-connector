import type { ConnectionSummary } from "../../connection-service.ts";
import type { ActionPolicyDecision } from "../../core/action-policy.ts";
import type { ActionDefinition, JsonSchema } from "../../core/types.ts";
import type { BlockContent, DefinitionContent, ListItem, PhrasingContent, Root, TableCell, TableRow } from "mdast";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import { describeSchemaType, readSchemaProperties, readSchemaRequired } from "../../core/json-schema.ts";

/** HTTP callers get request examples against the runtime's public origin. */
interface HttpActionGuideTransport {
  kind: "http";
  /** Public origin of the runtime, for example `https://connector.example.com`. */
  origin: string;
}

/** MCP callers get an `execute_action` tool example instead of HTTP requests. */
interface McpActionGuideTransport {
  kind: "mcp";
}

type ActionGuideTransport = HttpActionGuideTransport | McpActionGuideTransport;

export interface ActionMarkdownContext {
  /** How the caller executes actions; selects the examples and agent notes the guide renders. */
  transport: ActionGuideTransport;
  connection?: ConnectionSummary;
  policy?: ActionPolicyDecision;
}

/**
 * Render a compact action guide for coding agents and humans who want the raw
 * execution contract without browsing the full catalog JSON.
 */
export function renderActionMarkdown(action: ActionDefinition, context: ActionMarkdownContext): string {
  const exampleInput = buildExampleInput(action.inputSchema);
  const root: Root = {
    type: "root",
    children: [
      heading(1, action.id),
      ...markdownBlocks(action.description),
      heading(2, "Execute"),
      ...describeExecute(action, context.transport, exampleInput),
      heading(2, "Input Parameters"),
      ...describeParameters(action.inputSchema),
      heading(2, "Required Scopes"),
      ...describeStringList(action.requiredScopes, "No provider scopes are required."),
      heading(2, "Provider Permissions"),
      ...describeStringList(action.providerPermissions, "No provider permissions are declared."),
      heading(2, "Execution Policy"),
      ...describePolicy(context.policy),
      heading(2, "Current Connection"),
      ...describeConnection(context.connection),
      heading(2, "Notes For Agents"),
      list([
        context.transport.kind === "mcp"
          ? paragraph([
              "Use the ",
              inlineCode("execute_action"),
              " tool above; do not call provider APIs directly unless the user asks.",
            ])
          : textParagraph("Use the runtime endpoint above; do not call provider APIs directly unless the user asks."),
        paragraph(["Send JSON with a top-level ", inlineCode("input"), " object."]),
        textParagraph("Check the current connection and provider scopes before choosing actions on the user's behalf."),
        textParagraph(
          "If execution fails with a credential error, ask the user to connect the app in the local console.",
        ),
      ]),
    ],
  };

  return toMarkdown(root, {
    bullet: "-",
    fences: true,
    extensions: [gfmToMarkdown()],
  });
}

function describeExecute(
  action: ActionDefinition,
  transport: ActionGuideTransport,
  exampleInput: Record<string, unknown>,
): BlockContent[] {
  if (transport.kind === "mcp") {
    return [
      paragraph(["Call the ", inlineCode("execute_action"), " tool with these arguments:"]),
      code("json", JSON.stringify({ actionId: action.id, input: exampleInput }, null, 2)),
      paragraph([
        "Add ",
        inlineCode("connectionName"),
        " to run the action with a named connection instead of the default one.",
      ]),
    ];
  }

  const endpoint = `${transport.origin}/v1/actions/${action.id}`;
  const exampleBody = JSON.stringify({ input: exampleInput }, null, 2);
  return [
    code(
      "bash",
      [
        `curl -s ${endpoint} \\`,
        "  -H 'content-type: application/json' \\",
        `  -d ${shellSingleQuote(JSON.stringify({ input: exampleInput }))}`,
      ].join("\n"),
    ),
    code(
      "ts",
      [
        `const response = await fetch(${JSON.stringify(endpoint)}, {`,
        `  method: "POST",`,
        `  headers: { "content-type": "application/json" },`,
        `  body: JSON.stringify(${indentMultiline(exampleBody, 2)}),`,
        `});`,
        `const result = await response.json();`,
      ].join("\n"),
    ),
  ];
}

function describePolicy(policy: ActionPolicyDecision | undefined): BlockContent[] {
  if (!policy) {
    return [textParagraph("Allowed. No execution policy restrictions apply.")];
  }
  const summary = textParagraph(
    policy.allowed ? "Allowed by the current execution policy." : `Denied: ${policy.message}`,
  );
  if (policy.checks.length === 0) {
    return [summary, textParagraph("No policy rules matched or restricted this action.")];
  }
  return [
    summary,
    list(
      policy.checks.map((check) =>
        paragraph([
          inlineCode(check.source),
          ": ",
          inlineCode(check.outcome),
          ...(check.rule ? [" via ", inlineCode(check.rule)] : []),
        ]),
      ),
    ),
  ];
}

function describeConnection(connection: ConnectionSummary | undefined): BlockContent[] {
  if (!connection) {
    return [textParagraph("This provider is not connected in the local runtime.")];
  }

  const scopes: Array<string | PhrasingContent> =
    connection.profile.grantedScopes.length > 0
      ? joinPhrasing(
          connection.profile.grantedScopes.map((scope) => inlineCode(scope)),
          ", ",
        )
      : ["unknown or not provider-scoped"];

  return [
    list([
      paragraph(["Account: ", connection.profile.displayName]),
      paragraph(["Account ID: ", inlineCode(connection.profile.accountId)]),
      paragraph(["Auth type: ", inlineCode(connection.authType)]),
      paragraph(["Granted scopes: ", ...scopes]),
    ]),
  ];
}

function describeParameters(schema: JsonSchema): BlockContent[] {
  const properties = readSchemaProperties(schema);
  const entries = Object.entries(properties);
  if (entries.length === 0) {
    return [textParagraph("This action does not require input parameters.")];
  }

  const required = new Set(readSchemaRequired(schema));
  return [
    parameterTable(entries, required),
    listItems(
      entries.map(([name, property]) =>
        listItem([paragraph([inlineCode(name)]), ...markdownBlockContent(readDescription(property))]),
      ),
    ),
  ];
}

function parameterTable(entries: Array<[string, JsonSchema]>, required: Set<string>): BlockContent {
  return {
    type: "table",
    align: [null, null, null],
    children: [
      tableRow(["Name", "Required", "Type"].map(textTableCell)),
      ...entries.map(([name, property]) =>
        tableRow([
          inlineCodeTableCell(name),
          textTableCell(required.has(name) ? "Yes" : "No"),
          inlineCodeTableCell(describeSchemaType(property)),
        ]),
      ),
    ],
  };
}

function describeStringList(values: string[], emptyText: string): BlockContent[] {
  return values.length > 0 ? [list(values.map((value) => paragraph([inlineCode(value)])))] : [textParagraph(emptyText)];
}

function markdownBlocks(value: string): DocumentContent[] {
  const text = value.trim();
  if (!text) {
    return [];
  }
  return fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }).children.filter(isDocumentContent);
}

function markdownBlockContent(value: string): BlockContent[] {
  return markdownBlocks(value).filter(isBlockContent);
}

function heading(depth: 1 | 2, value: string): BlockContent {
  return { type: "heading", depth, children: [{ type: "text", value }] };
}

function paragraph(children: Array<string | PhrasingContent>): BlockContent {
  return {
    type: "paragraph",
    children: children.map((child) => (typeof child === "string" ? { type: "text", value: child } : child)),
  };
}

function textParagraph(value: string): BlockContent {
  return paragraph([value]);
}

function inlineCode(value: string): PhrasingContent {
  return { type: "inlineCode", value };
}

function code(lang: string, value: string): BlockContent {
  return { type: "code", lang, value };
}

function list(children: BlockContent[]): BlockContent {
  return listItems(children.map((child) => listItem([child])));
}

function listItems(children: ListItem[]): BlockContent {
  return {
    type: "list",
    ordered: false,
    spread: false,
    children,
  };
}

function listItem(children: BlockContent[]): ListItem {
  return { type: "listItem", spread: children.length > 1, children };
}

function joinPhrasing(values: PhrasingContent[], separator: string): Array<string | PhrasingContent> {
  return values.flatMap((value, index) => (index === 0 ? [value] : [separator, value]));
}

function tableRow(children: TableCell[]): TableRow {
  return { type: "tableRow", children };
}

function textTableCell(value: string): TableCell {
  return { type: "tableCell", children: [{ type: "text", value }] };
}

function inlineCodeTableCell(value: string): TableCell {
  return { type: "tableCell", children: [{ type: "inlineCode", value }] };
}

/** Quote a value for a POSIX shell so an apostrophe inside an example does not end the argument. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function indentMultiline(value: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function isDocumentContent(node: Root["children"][number]): node is BlockContent | DefinitionContent {
  return [
    "blockquote",
    "code",
    "definition",
    "footnoteDefinition",
    "heading",
    "html",
    "list",
    "paragraph",
    "table",
    "thematicBreak",
  ].includes(node.type);
}

function isBlockContent(node: DocumentContent): node is BlockContent {
  return node.type !== "definition" && node.type !== "footnoteDefinition";
}

type DocumentContent = BlockContent | DefinitionContent;

const exampleStringFormats: Record<string, string> = {
  date: "2000-01-01",
  "date-time": "2000-01-01T00:00:00Z",
  email: "user@example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  uri: "https://example.com",
  url: "https://example.com",
  uuid: "00000000-0000-4000-8000-000000000000",
};

function buildExampleInput(schema: JsonSchema): Record<string, unknown> {
  const properties = readSchemaProperties(schema);
  const input: Record<string, unknown> = {};
  seedObjectRequirements(schema, properties, input);
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      if (isSchemaObject(member)) {
        seedObjectRequirements(member, properties, input);
      }
    }
  }
  fillMinProperties(schema, properties, input);
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      if (isSchemaObject(member)) {
        fillMinProperties(member, { ...properties, ...readSchemaProperties(member) }, input);
      }
    }
  }
  return input;
}

/** Raise the object to its `minProperties` with named properties first, then placeholder map keys. */
function fillMinProperties(
  schema: JsonSchema,
  properties: Record<string, JsonSchema>,
  input: Record<string, unknown>,
): void {
  const minProperties = typeof schema.minProperties === "number" ? schema.minProperties : 0;
  if (minProperties === 0) {
    return;
  }
  for (const name of Object.keys(properties)) {
    if (Object.keys(input).length >= minProperties) {
      break;
    }
    if (!(name in input)) {
      input[name] = exampleValue(properties[name]);
    }
  }
  if (isSchemaObject(schema.additionalProperties)) {
    // A map-shaped object such as attributes or records reaches minProperties
    // only through its additional properties; placeholder keys fill the deficit
    // while still matching the outer schema. Bounded so a property named like a
    // placeholder cannot loop forever.
    for (let index = 0; Object.keys(input).length < minProperties && index < minProperties + 10; index += 1) {
      const name = index === 0 ? "key" : `key${index + 1}`;
      if (name in input) {
        continue;
      }
      input[name] = exampleValue(schema.additionalProperties);
    }
  }
}

/** Seed every property requirement an object schema (or one `allOf` member) declares. */
function seedObjectRequirements(
  schema: JsonSchema,
  properties: Record<string, JsonSchema>,
  input: Record<string, unknown>,
): void {
  seedRequiredProperties(schema, properties, input);
  seedRequirementBranches(schema, properties, input);
}

/**
 * `requireAnyProperty`/`requireExactlyOneProperty` keep every property optional
 * and add `anyOf`/`oneOf` branches that each require some property, so an example
 * that only seeds `required` can never match. Seed the properties the first
 * usable branch asks for, using the branch's own property schemas.
 */
function seedRequirementBranches(
  schema: JsonSchema,
  properties: Record<string, JsonSchema>,
  input: Record<string, unknown>,
): void {
  const branches = [schema.anyOf, schema.oneOf].find(Array.isArray);
  if (!Array.isArray(branches)) {
    return;
  }
  const candidates = branches
    .filter(isSchemaObject)
    .filter((branch) => branch.type !== "null" && !conflictsWithParent(schema, branch));
  const isOneOf = Array.isArray(schema.oneOf);
  if (isOneOf) {
    const alreadySatisfied = candidates.some((branch) => {
      const required = readSchemaRequired(branch);
      return required.length > 0 && required.every((name) => name in input);
    });
    if (alreadySatisfied) {
      return;
    }
  }
  for (const branch of candidates) {
    const merged = mergeBranch(schema, branch);
    const required = readSchemaRequired(merged);
    if (required.length === 0) {
      continue;
    }
    const mergedProperties = readSchemaProperties(merged);
    for (const name of required) {
      input[name] = exampleValue(mergedProperties[name] ?? properties[name]);
    }
    return;
  }
  if (!isOneOf) {
    return;
  }
  // A oneOf whose branches only differ by which properties they allow needs a
  // member of exactly one branch. Seed the first branch so the others, which
  // either forbid these properties or want their own, cannot also match.
  const branch = candidates[0];
  if (!branch) {
    return;
  }
  const mergedProperties = readSchemaProperties(mergeBranch(schema, branch));
  for (const name of Object.keys(mergedProperties)) {
    input[name] = exampleValue(mergedProperties[name]);
  }
}

function seedRequiredProperties(
  schema: JsonSchema,
  fallbackProperties: Record<string, JsonSchema>,
  input: Record<string, unknown>,
): void {
  const properties = readSchemaProperties(schema);
  for (const name of readSchemaRequired(schema)) {
    if (!(name in input)) {
      input[name] = exampleValue(properties[name] ?? fallbackProperties[name]);
    }
  }
}

function isSchemaObject(value: unknown): value is JsonSchema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Unwrap one `anyOf`/`oneOf` branch while keeping the wrapper's own keywords, so
 * a branch that only adds `required`/`properties` inherits the parent type. Same
 * named properties are merged so the branch adds constraints instead of
 * replacing the parent's (`format` plus `minLength`, for example). The
 * combinators are dropped so the merged schema is not unwrapped again.
 */
function mergeBranch(schema: JsonSchema, branch: JsonSchema): JsonSchema {
  const merged = { ...schema, ...branch };
  const schemaProperties = readSchemaProperties(schema);
  const branchProperties = readSchemaProperties(branch);
  if (Object.keys(schemaProperties).length > 0 && Object.keys(branchProperties).length > 0) {
    const properties: Record<string, JsonSchema> = { ...schemaProperties, ...branchProperties };
    for (const [name, branchProperty] of Object.entries(branchProperties)) {
      const parentProperty = schemaProperties[name];
      if (parentProperty) {
        properties[name] = { ...parentProperty, ...branchProperty };
      }
    }
    merged.properties = properties;
  }
  const schemaRequired = readSchemaRequired(schema);
  const branchRequired = readSchemaRequired(branch);
  if (schemaRequired.length > 0 || branchRequired.length > 0) {
    merged.required = [...new Set([...schemaRequired, ...branchRequired])];
  }
  delete merged.anyOf;
  delete merged.oneOf;
  return merged;
}

function readDescription(schema: JsonSchema | undefined): string {
  return schema && typeof schema.description === "string" ? schema.description : "";
}

function exampleValue(schema: JsonSchema | undefined): unknown {
  if (!schema) {
    return "";
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (schema.const !== undefined) {
    return schema.const;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const branch = firstActionableBranch(schema);
  if (branch) {
    return exampleValue(branch);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== "null") : schema.type;
  if (type === undefined || type === "null") {
    return type === "null" ? null : stringExample(schema);
  }
  if (type === "integer" || type === "number") {
    return numberExample(schema);
  }
  if (type === "boolean") {
    return false;
  }
  if (type === "array") {
    return arrayExample(schema);
  }
  if (type === "object") {
    return objectExample(schema);
  }
  return stringExample(schema);
}

/** Unwrap `anyOf`/`oneOf` wrappers such as nullable fields, choosing the first non-null branch. */
function firstActionableBranch(schema: JsonSchema): JsonSchema | undefined {
  const branches = [schema.anyOf, schema.oneOf].find(Array.isArray);
  if (!Array.isArray(branches)) {
    return undefined;
  }
  for (const branch of branches) {
    if (isSchemaObject(branch) && branch.type !== "null" && !conflictsWithParent(schema, branch)) {
      return mergeBranch(schema, branch);
    }
  }
  return mergeBranch(schema, { type: "null" });
}

/**
 * A branch that pins a property the parent already pins with `const` to another
 * value can never match; a discriminated `oneOf` relies on this.
 */
function conflictsWithParent(schema: JsonSchema, branch: JsonSchema): boolean {
  const parentProperties = readSchemaProperties(schema);
  for (const [name, branchProperty] of Object.entries(readSchemaProperties(branch))) {
    const parentProperty = parentProperties[name];
    if (
      isSchemaObject(branchProperty) &&
      isSchemaObject(parentProperty) &&
      branchProperty.const !== undefined &&
      parentProperty.const !== undefined &&
      branchProperty.const !== parentProperty.const
    ) {
      return true;
    }
  }
  return false;
}

function stringExample(schema: JsonSchema): string {
  if (typeof schema.format === "string") {
    return exampleStringFormats[schema.format] ?? "string";
  }
  const minLength = typeof schema.minLength === "number" && schema.minLength > 0 ? schema.minLength : 0;
  if (minLength === 0 && typeof schema.pattern !== "string") {
    return "";
  }
  const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
  const length = Math.min(Math.max(1, minLength || 1), maxLength ?? Number.POSITIVE_INFINITY);
  return length <= 0 ? "" : "a".repeat(Math.min(length, Math.max(64, minLength)));
}

function numberExample(schema: JsonSchema): number {
  const integer = schema.type === "integer";
  const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
  const exclusiveMinimum = typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum : undefined;
  const exclusiveMaximum = typeof schema.exclusiveMaximum === "number" ? schema.exclusiveMaximum : undefined;
  let candidate = 1;
  if (minimum !== undefined) {
    candidate = Math.max(candidate, minimum);
  }
  if (exclusiveMinimum !== undefined) {
    candidate = Math.max(candidate, integer ? Math.floor(exclusiveMinimum) + 1 : exclusiveMinimum + 1);
  }
  if (maximum !== undefined && candidate > maximum) {
    candidate = maximum;
  }
  if (exclusiveMaximum !== undefined && candidate >= exclusiveMaximum) {
    candidate = integer ? Math.ceil(exclusiveMaximum) - 1 : exclusiveMaximum - 1;
  }
  if (
    exclusiveMinimum !== undefined &&
    exclusiveMaximum !== undefined &&
    candidate <= exclusiveMinimum &&
    Number.isFinite(exclusiveMinimum) &&
    Number.isFinite(exclusiveMaximum)
  ) {
    // Both exclusive bounds push the candidate outside the interval; a value
    // between them is the only one that can satisfy both.
    candidate = (exclusiveMinimum + exclusiveMaximum) / 2;
  }
  return integer ? Math.floor(candidate) : candidate;
}

function arrayExample(schema: JsonSchema): unknown[] {
  const minItems = typeof schema.minItems === "number" && schema.minItems > 0 ? schema.minItems : 0;
  const itemSchema = Array.isArray(schema.items) ? undefined : (schema.items as JsonSchema | undefined);
  const values = Array.isArray(schema.prefixItems)
    ? schema.prefixItems.map((item) => exampleValue(item as JsonSchema))
    : [];
  while (values.length < minItems) {
    values.push(exampleValue(itemSchema));
  }
  const distinct = new Set(values.map((value) => JSON.stringify(value))).size === values.length;
  if (schema.uniqueItems === true && values.length > 1 && !distinct) {
    if (itemSchema?.type === "string") {
      return values.map((_, index) => String.fromCharCode(97 + index));
    }
    if (itemSchema?.type === "integer" || itemSchema?.type === "number") {
      return values.map((_, index) => index + 1);
    }
  }
  return values;
}

function objectExample(schema: JsonSchema): Record<string, unknown> {
  const properties = readSchemaProperties(schema);
  const input: Record<string, unknown> = {};
  for (const name of readSchemaRequired(schema)) {
    input[name] = exampleValue(properties[name]);
  }
  fillMinProperties(schema, properties, input);
  return input;
}
