import {
  EnvironmentSecretsSchema,
  type EnvironmentSecrets,
} from "@scarline/contracts";
import { randomBytes } from "node:crypto";
import { appendFile, chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ProjectError, describeError } from "./errors.js";

const SECRET_DOMAINS = [
  {
    comment: "PostgreSQL secrets",
    keys: ["POSTGRES_PASSWORD"],
  },
  {
    comment: "RabbitMQ secrets",
    keys: ["RABBITMQ_DEFAULT_PASS"],
  },
  {
    comment: "CoreAPI authentication secrets",
    keys: ["JWT_ACCESS_SECRET", "REFRESH_TOKEN_PEPPER"],
  },
  {
    comment: "CoreAPI one-time administrator secret",
    keys: ["BOOTSTRAP_ADMIN_PASSWORD"],
  },
  {
    comment: "Overlay control authentication secret",
    keys: ["OVERLAY_CONTROL_SECRET"],
  },
  {
    comment: "Simulator adapter authentication secret",
    keys: ["SIM_BRIDGE_ADAPTER_SECRET"],
  },
] as const satisfies readonly {
  readonly comment: string;
  readonly keys: readonly (keyof EnvironmentSecrets)[];
}[];

const SECRET_KEYS = SECRET_DOMAINS.flatMap(({ keys }) => keys);

export interface EnsuredEnvironment {
  readonly secrets: EnvironmentSecrets;
  readonly envPath: string;
  readonly created: boolean;
  readonly generatedKeys: readonly (keyof EnvironmentSecrets)[];
}

export interface LoadedEnvironment {
  readonly secrets: EnvironmentSecrets;
  readonly envPath: string;
}

function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function parseValue(rawValue: string, lineNumber: number): string {
  const value = rawValue.trim();
  if (value.length === 0) {
    return "";
  }

  const quote = value[0];
  if (quote === '"' || quote === "'") {
    if (value.at(-1) !== quote) {
      throw new ProjectError(
        `Invalid .env syntax on line ${lineNumber}: missing closing quote.`,
      );
    }

    const unquoted = value.slice(1, -1);
    return quote === '"'
      ? unquoted
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\")
      : unquoted;
  }

  const commentIndex = value.search(/\s+#/);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trimEnd();
}

export function parseEnvironmentFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const assignment = line.startsWith("export ")
      ? line.slice(7).trimStart()
      : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) {
      throw new ProjectError(`Invalid .env syntax on line ${index + 1}.`);
    }

    const key = assignment.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new ProjectError(`Invalid .env key on line ${index + 1}.`);
    }
    if (Object.hasOwn(values, key)) {
      throw new ProjectError(`Duplicate .env key: ${key}.`);
    }

    values[key] = parseValue(assignment.slice(equalsIndex + 1), index + 1);
  }

  return values;
}

function renderDomains(
  values: Readonly<Partial<Record<keyof EnvironmentSecrets, string>>>,
  onlyKeys: ReadonlySet<keyof EnvironmentSecrets>,
): string {
  const sections: string[] = [];

  for (const domain of SECRET_DOMAINS) {
    const keys = domain.keys.filter((key) => onlyKeys.has(key));
    if (keys.length === 0) {
      continue;
    }
    sections.push(
      [
        `# ${domain.comment}`,
        ...keys.map((key) => `${key}=${values[key] ?? ""}`),
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

function validateSecrets(values: Record<string, string>): EnvironmentSecrets {
  const unknownKeys = Object.keys(values).filter(
    (key) => !SECRET_KEYS.includes(key as keyof EnvironmentSecrets),
  );
  if (unknownKeys.length > 0) {
    throw new ProjectError(`Unknown secret key(s) in .env: ${unknownKeys.join(", ")}.`);
  }

  const result = EnvironmentSecretsSchema.safeParse(values);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || ".env"}: ${issue.message}`)
      .join("; ");
    throw new ProjectError(`Invalid .env: ${issues}`);
  }
  return result.data;
}

async function restrictEnvironmentPermissions(envPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await chmod(envPath, 0o600);
}

export async function loadEnvironmentSecrets(
  repositoryRoot: string,
): Promise<LoadedEnvironment> {
  const envPath = path.join(repositoryRoot, ".env");

  try {
    const contents = await readFile(envPath, "utf8");
    return {
      secrets: validateSecrets(parseEnvironmentFile(contents)),
      envPath,
    };
  } catch (error) {
    if (error instanceof ProjectError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ProjectError(".env does not exist. Run scarline setup.");
    }
    throw new ProjectError(`Unable to read .env: ${describeError(error)}`, {
      cause: error,
    });
  }
}

export async function ensureEnvironmentSecrets(
  repositoryRoot: string,
): Promise<EnsuredEnvironment> {
  const envPath = path.join(repositoryRoot, ".env");
  const envExamplePath = path.join(repositoryRoot, ".env.example");
  let contents: string;
  let created = false;

  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ProjectError(`Unable to read .env: ${describeError(error)}`, {
        cause: error,
      });
    }
    contents = "";
    created = true;
  }

  const existingValues = parseEnvironmentFile(contents);
  let exampleValues: Record<string, string>;
  try {
    exampleValues = parseEnvironmentFile(await readFile(envExamplePath, "utf8"));
  } catch (error) {
    throw new ProjectError(`Unable to read .env.example: ${describeError(error)}`, {
      cause: error,
    });
  }
  const generatedValues: Partial<Record<keyof EnvironmentSecrets, string>> = {};
  const generatedKeys = SECRET_KEYS.filter(
    (key) => !Object.hasOwn(existingValues, key),
  );

  for (const key of generatedKeys) {
    if (key === "BOOTSTRAP_ADMIN_PASSWORD") {
      const bootstrapPassword = exampleValues.BOOTSTRAP_ADMIN_PASSWORD;
      if (bootstrapPassword === undefined || bootstrapPassword.length === 0) {
        throw new ProjectError(
          ".env.example must define BOOTSTRAP_ADMIN_PASSWORD for the one-time administrator.",
        );
      }
      generatedValues[key] = bootstrapPassword;
    } else {
      generatedValues[key] = generateSecret();
    }
  }

  const secrets = validateSecrets({
    ...existingValues,
    ...generatedValues,
  });

  if (created) {
    const allValues = Object.fromEntries(
      SECRET_KEYS.map((key) => [key, generatedValues[key]]),
    ) as Partial<Record<keyof EnvironmentSecrets, string>>;
    await writeFile(envPath, `${renderDomains(allValues, new Set(SECRET_KEYS))}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } else if (generatedKeys.length > 0) {
    const separator =
      contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
    await appendFile(
      envPath,
      `${separator}${contents.trim().length === 0 ? "" : "\n"}${renderDomains(
        generatedValues,
        new Set(generatedKeys),
      )}\n`,
      "utf8",
    );
  }

  try {
    await restrictEnvironmentPermissions(envPath);
  } catch (error) {
    throw new ProjectError(`Unable to secure .env permissions: ${describeError(error)}`, {
      cause: error,
    });
  }

  return {
    secrets,
    envPath,
    created,
    generatedKeys,
  };
}
