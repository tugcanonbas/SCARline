import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CoreApiSecretsSchema,
  ScarlineConfigSchema,
  type CoreApiSecrets,
  type ScarlineConfig,
} from "@scarline/contracts";
import { parse } from "yaml";

export interface CoreApiConfig {
  readonly project: ScarlineConfig;
  readonly secrets: CoreApiSecrets;
  readonly repositoryRoot: string;
}

async function findRepositoryRoot(startDirectory: string): Promise<string> {
  let candidate = path.resolve(startDirectory);

  for (;;) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(candidate, "package.json"), "utf8"),
      ) as { name?: unknown };
      await readFile(path.join(candidate, "config.yml"), "utf8");
      if (packageJson.name === "scarline") {
        return candidate;
      }
    } catch {
      // Continue towards the filesystem root.
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`Unable to locate the SCARline repository from ${startDirectory}.`);
    }
    candidate = parent;
  }
}

function formatIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
    .join("; ");
}

export async function loadCoreApiConfig(
  repositoryRoot?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CoreApiConfig> {
  const resolvedRoot =
    repositoryRoot === undefined
      ? await findRepositoryRoot(process.cwd())
      : path.resolve(repositoryRoot);
  const configPath = path.join(resolvedRoot, "config.yml");

  let rawConfig: unknown;
  try {
    rawConfig = parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read config.yml: ${error instanceof Error ? error.message : "unknown error"}`,
      { cause: error },
    );
  }

  const configResult = ScarlineConfigSchema.safeParse(rawConfig);
  if (!configResult.success) {
    throw new Error(`Invalid config.yml: ${formatIssues(configResult.error.issues)}`);
  }

  const secretResult = CoreApiSecretsSchema.safeParse({
    POSTGRES_PASSWORD: environment.POSTGRES_PASSWORD,
    RABBITMQ_DEFAULT_PASS: environment.RABBITMQ_DEFAULT_PASS,
    JWT_ACCESS_SECRET: environment.JWT_ACCESS_SECRET,
    REFRESH_TOKEN_PEPPER: environment.REFRESH_TOKEN_PEPPER,
    BOOTSTRAP_ADMIN_PASSWORD: environment.BOOTSTRAP_ADMIN_PASSWORD,
    OVERLAY_CONTROL_SECRET: environment.OVERLAY_CONTROL_SECRET,
  });
  if (!secretResult.success) {
    throw new Error(
      `Invalid CoreAPI environment: ${formatIssues(secretResult.error.issues)}`,
    );
  }

  return {
    project: configResult.data,
    secrets: secretResult.data,
    repositoryRoot: resolvedRoot,
  };
}
