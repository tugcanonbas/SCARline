import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { ProjectError } from "./errors.js";

const REQUIRED_ROOT_FILES = ["package.json", "config.yml", ".env.example"] as const;

async function isReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isScarlineRoot(directory: string): Promise<boolean> {
  const hasRequiredFiles = await Promise.all(
    REQUIRED_ROOT_FILES.map((file) => isReadable(path.join(directory, file))),
  );

  if (hasRequiredFiles.some((exists) => !exists)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    ) as { name?: unknown };
    return packageJson.name === "scarline";
  } catch {
    return false;
  }
}

export async function findRepositoryRoot(startDirectory: string): Promise<string> {
  let candidate = path.resolve(startDirectory);

  while (true) {
    if (await isScarlineRoot(candidate)) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new ProjectError(
        "No SCARline repository found. Run this command from a SCARline clone.",
      );
    }
    candidate = parent;
  }
}

export function resolvePathInsideRepository(
  repositoryRoot: string,
  configuredPath: string,
  label: string,
): string {
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedPath = path.resolve(resolvedRoot, configuredPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new ProjectError(`${label} must resolve inside the repository.`);
  }

  return resolvedPath;
}
