<script lang="ts">
  let { value = $bindable("") } = $props<{ value?: string }>();

  const VARIABLES = [
    { value: "vehicle.speed", label: "Vehicle speed" },
    { value: "vehicle.speedLimit", label: "Speed limit" },
    { value: "vehicle.throttle", label: "Throttle" },
    { value: "vehicle.brake", label: "Brake" },
    { value: "session.elapsedSeconds", label: "Elapsed time (seconds)" },
  ];

  const OPERATORS = [
    { value: ">", label: "is greater than" },
    { value: "<", label: "is less than" },
    { value: ">=", label: "is at least" },
    { value: "<=", label: "is at most" },
    { value: "==", label: "equals" },
    { value: "!=", label: "does not equal" },
  ];

  const EXPRESSION_PATTERN =
    /^\s*([\w.]+)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?|[\w.]+)\s*$/;

  function isKnownVariable(candidate: string) {
    return VARIABLES.some((variable) => variable.value === candidate);
  }

  function parseExpression(expression: string) {
    const match = expression.match(EXPRESSION_PATTERN);
    if (!match) return null;
    const [, left, operator, right] = match;
    if (!isKnownVariable(left)) return null;
    return { left, operator, right };
  }

  const initialParsed = parseExpression(value);

  // Fall back to a plain text field for expressions the simple builder
  // doesn't understand, so existing/advanced conditions are never silently
  // rewritten or lost.
  let useCustomExpression = $state(!value || !initialParsed);
  let left = $state(initialParsed?.left ?? VARIABLES[0].value);
  let operator = $state(initialParsed?.operator ?? ">");
  let rightIsVariable = $state(
    initialParsed ? isKnownVariable(initialParsed.right) : true,
  );
  let rightVariable = $state(
    initialParsed && isKnownVariable(initialParsed.right)
      ? initialParsed.right
      : VARIABLES[1].value,
  );
  let rightNumber = $state(
    initialParsed && !isKnownVariable(initialParsed.right)
      ? initialParsed.right
      : "0",
  );

  function syncFromBuilder() {
    const right = rightIsVariable ? rightVariable : rightNumber;
    value = `${left} ${operator} ${right}`;
  }
</script>

{#if useCustomExpression}
  <input
    bind:value
    class="trigger-input trigger-input--wide"
    placeholder="e.g. vehicle.speed > vehicle.speedLimit"
    type="text"
  />
  <button
    class="condition-builder-toggle"
    onclick={() => (useCustomExpression = false)}
    type="button">Use simple builder</button
  >
{:else}
  <div class="condition-builder">
    <select bind:value={left} onchange={syncFromBuilder}>
      {#each VARIABLES as variable}
        <option value={variable.value}>{variable.label}</option>
      {/each}
    </select>
    <select bind:value={operator} onchange={syncFromBuilder}>
      {#each OPERATORS as op}
        <option value={op.value}>{op.label}</option>
      {/each}
    </select>
    {#if rightIsVariable}
      <select bind:value={rightVariable} onchange={syncFromBuilder}>
        {#each VARIABLES as variable}
          <option value={variable.value}>{variable.label}</option>
        {/each}
      </select>
    {:else}
      <input
        bind:value={rightNumber}
        onchange={syncFromBuilder}
        oninput={syncFromBuilder}
        step="any"
        type="number"
      />
    {/if}
    <label class="condition-builder__toggle-value">
      <input
        bind:checked={rightIsVariable}
        onchange={syncFromBuilder}
        type="checkbox"
      />
      Compare to another value instead of a number
    </label>
  </div>
  <button
    class="condition-builder-toggle"
    onclick={() => (useCustomExpression = true)}
    type="button">Use custom expression</button
  >
{/if}
