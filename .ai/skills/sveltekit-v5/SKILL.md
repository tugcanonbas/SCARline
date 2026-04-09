---
name: "sveltekit-v5"
description: "Rules for modern Svelte 5 development using Runes and SvelteKit patterns."
license: "Apache-2.0"
---

# Svelte 5 & SvelteKit Skill

The SCARline Admin Panel is built using modern **Svelte 5** and **SvelteKit**. You must avoid outdated Svelte 4 syntax and rely completely on Svelte 5 Runes.

## 1. Svelte 5 Runes (Mandatory)

Always use Runes for reactivity framework-wide. Do not use legacy patterns.

- **State**: Use `let count = $state(0)` instead of `let count = 0` (implicit reactivity).
- **Derived**: Use `let doubled = $derived(count * 2)` instead of `$: doubled = count * 2`.
- **Effects**: Use `$effect(() => { ... })` instead of `onMount` or `$:`.
- **Props**: Use `let { myProp } = $props()` instead of `export let myProp`.
- **Bindable**: Use `let { value = $bindable() } = $props()` for two-way binding props.

## 2. Component Syntax

Svelte 5 handles events and slots differently:

- **Events**: Use native event handler syntax (`onclick={handleClick}`, `onkeydown={...}`) instead of the deprecated DOM event syntax (`on:click={handleClick}`).
- **Snippets (Slots)**: Use `{#snippet name(args)}` and `{@render name(args)}` instead of `<slot />`.

## 3. SvelteKit Best Practices

- Use SvelteKit's standard `+page.server.ts` or `+page.ts` `load` functions for data fetching.
- Use SvelteKit form actions (`export const actions = { default: async () => {} }`) for data mutations.
- Keep components small and placed inside `$lib/components/`.
- Use `$lib` aliases for all interior imports (e.g., `import { format } from '$lib/utils';`).

## 4. Code Style

- Prefix local event handler functions with "handle" (e.g., `handleFormSubmit`).
- Maintain strictly-typed TypeScript across all Svelte files (`<script lang="ts">`).
