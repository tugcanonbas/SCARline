import { mkdir, writeFile } from "node:fs/promises";

import { z } from "zod";

import { jsonSchemaSources } from "../dist/index.js";

const outputDirectory = new URL("../dist/json-schema/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });

for (const [name, schema] of Object.entries(jsonSchemaSources)) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    unrepresentable: "any",
  });

  jsonSchema.$id = `urn:scarline:contract:${name}`;
  jsonSchema.title = name;

  await writeFile(
    new URL(`${name}.schema.json`, outputDirectory),
    `${JSON.stringify(jsonSchema, null, 2)}\n`,
  );
}
