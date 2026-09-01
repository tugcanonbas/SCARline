import { TriggerExpressionSchema } from "@scarline/contracts";

type Scalar = string | number | boolean | null;

export function evaluateTriggerExpression(expression: unknown, context: Record<string, unknown>): boolean {
  const parsed = TriggerExpressionSchema.parse(expression) as Record<string, unknown>;
  return evaluate(parsed, context);
}

function evaluate(expression: Record<string, unknown>, context: Record<string, unknown>): boolean {
  const operator = expression.operator;
  if (operator === "and") return (expression.expressions as Record<string, unknown>[]).every((item) => evaluate(item, context));
  if (operator === "or") return (expression.expressions as Record<string, unknown>[]).some((item) => evaluate(item, context));
  if (operator === "not") return !evaluate(expression.expression as Record<string, unknown>, context);
  const actual = readPath(context, String(expression.path));
  const expected = "valuePath" in expression
    ? readPath(context, String(expression.valuePath))
    : expression.value as Scalar | Scalar[];
  if (operator === "eq") return Object.is(actual, expected);
  if (operator === "ne") return !Object.is(actual, expected);
  if (operator === "in") return Array.isArray(expected) && expected.some((item) => Object.is(actual, item));
  if ((typeof actual !== "number" && typeof actual !== "string") || (typeof expected !== "number" && typeof expected !== "string")) return false;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  return false;
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (["__proto__", "prototype", "constructor"].includes(segment)) return undefined;
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
