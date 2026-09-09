import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ScarlineConfigSchema,
  SimulatorAdapterSecretsSchema,
  type ScarlineConfig,
  type SimulatorAdapterSecrets,
} from "@scarline/contracts";
import { parse } from "yaml";

export interface MockSimulatorConfig {
  readonly project: ScarlineConfig;
  readonly secrets: SimulatorAdapterSecrets;
  readonly repositoryRoot: string;
  readonly bridgeUrl: string;
  readonly commandJournalPath: string;
}

function formatIssues(
  issues: readonly { readonly path: PropertyKey[]; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`).join("; ");
}

async function findRepositoryRoot(startDirectory: string): Promise<string> {
  let candidate = path.resolve(startDirectory);
  for (;;) {
    try {
      const packageJson = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")) as { name?: unknown };
      await readFile(path.join(candidate, "config.yml"), "utf8");
      if (packageJson.name === "scarline") return candidate;
    } catch {
      // Continue towards the filesystem root.
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error(`Unable to locate the SCARline repository from ${startDirectory}.`);
    candidate = parent;
  }
}

export async function loadMockSimulatorConfig(
  repositoryRoot?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MockSimulatorConfig> {
  const root = repositoryRoot === undefined ? await findRepositoryRoot(process.cwd()) : path.resolve(repositoryRoot);
  const project = ScarlineConfigSchema.safeParse(
    parse(await readFile(path.join(root, "config.yml"), "utf8")) as unknown,
  );
  if (!project.success) throw new Error(`Invalid config.yml: ${formatIssues(project.error.issues)}`);
  const secrets = SimulatorAdapterSecretsSchema.safeParse({
    SIM_BRIDGE_ADAPTER_SECRET: environment.SIM_BRIDGE_ADAPTER_SECRET,
  });
  if (!secrets.success) throw new Error(`Invalid Mock Simulator environment: ${formatIssues(secrets.error.issues)}`);
  const journalPath = path.resolve(root, project.data.simulator.mock.command_journal);
  const runtimePath = path.resolve(root, project.data.platform.runtime_directory);
  const relative = path.relative(runtimePath, journalPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("simulator.mock.command_journal must resolve inside platform.runtime_directory.");
  }
  const bridge = project.data.sim_bridge;
  return {
    project: project.data,
    secrets: secrets.data,
    repositoryRoot: root,
    bridgeUrl: `ws://${bridge.host}:${bridge.port}${bridge.adapter_path}`,
    commandJournalPath: journalPath,
  };
}
