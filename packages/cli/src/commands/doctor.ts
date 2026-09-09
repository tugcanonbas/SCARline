import type { Command } from "../command.js";
import { collectDoctorChecks } from "../diagnostics/doctor.js";
import { describeError, findRepositoryRoot } from "../project/index.js";

const STATUS_LABELS = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
} as const;

export const doctorCommand: Command = {
  name: "doctor",
  description: "Check the local SCARline environment",
  async run(args, context) {
    if (args.length > 0) {
      context.stderr(`Unknown doctor option: ${args[0]}`);
      return 1;
    }

    context.stdout("SCARline doctor");
    context.stdout("");

    try {
      const repositoryRoot = await findRepositoryRoot(context.cwd);
      const checks = await collectDoctorChecks(repositoryRoot);

      for (const result of checks) {
        context.stdout(
          `[${STATUS_LABELS[result.status]}] ${result.name}: ${result.detail}`,
        );
      }

      const passed = checks.filter(({ status }) => status === "pass").length;
      const warnings = checks.filter(({ status }) => status === "warn").length;
      const failures = checks.filter(({ status }) => status === "fail").length;
      context.stdout("");
      context.stdout(
        `Summary: ${passed} passed, ${warnings} warning${warnings === 1 ? "" : "s"}, ${failures} failure${failures === 1 ? "" : "s"}`,
      );
      return failures === 0 ? 0 : 1;
    } catch (error) {
      context.stderr(`[FAIL] Repository: ${describeError(error)}`);
      context.stderr("");
      context.stderr("Summary: 0 passed, 0 warnings, 1 failure");
      return 1;
    }
  },
};
