import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ScarlineConfigSchema,
  SimBridgeSecretsSchema,
  type ScarlineConfig,
  type SimBridgeSecrets,
} from "@scarline/contracts";
import { parse } from "yaml";

export interface SimBridgeConfig {
  readonly project: ScarlineConfig;
  readonly secrets: SimBridgeSecrets;
  readonly repositoryRoot: string;
  readonly commandJournalPath: string;
}

function formatIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
    .join("; ");
}

async function findRepositoryRoot(startDirectory: string): Promise<string> {
  let candidate = path.resolve(startDirectory);
  for (;;) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(candidate, "package.json"), "utf8"),
      ) as { name?: unknown };
      await readFile(path.join(candidate, "config.yml"), "utf8");
      if (packageJson.name === "scarline") return candidate;
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

export async function loadSimBridgeConfig(
  repositoryRoot?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<SimBridgeConfig> {
  const root = repositoryRoot === undefined
    ? await findRepositoryRoot(process.cwd())
    : path.resolve(repositoryRoot);
  const raw = parse(await readFile(path.join(root, "config.yml"), "utf8")) as unknown;
  const project = ScarlineConfigSchema.safeParse(raw);
  if (!project.success) {
    throw new Error(`Invalid config.yml: ${formatIssues(project.error.issues)}`);
  }
  const secrets = SimBridgeSecretsSchema.safeParse({
    RABBITMQ_DEFAULT_PASS: environment.RABBITMQ_DEFAULT_PASS,
    SIM_BRIDGE_ADAPTER_SECRET: environment.SIM_BRIDGE_ADAPTER_SECRET,
  });
  if (!secrets.success) {
    throw new Error(`Invalid Sim Bridge environment: ${formatIssues(secrets.error.issues)}`);
  }
  const journalPath = path.resolve(root, project.data.sim_bridge.command_journal);
  const relative = path.relative(path.resolve(root, project.data.platform.runtime_directory), journalPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("sim_bridge.command_journal must resolve inside platform.runtime_directory.");
  }
  return {
    project: project.data,
    secrets: secrets.data,
    repositoryRoot: root,
    commandJournalPath: journalPath,
  };
}
