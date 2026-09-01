import type { CommandContext } from "../command.js";
import type { InfrastructureStatus } from "./compose.js";

export function printServiceStatus(
  status: InfrastructureStatus,
  context: CommandContext,
): void {
  for (const service of status.services) {
    const health = service.health.length > 0 ? `, ${service.health}` : "";
    const exit = service.state === "running" ? "" : `, exit ${service.exitCode}`;
    context.stdout(`  ${service.service}: ${service.state}${health}${exit}`);
  }
}
