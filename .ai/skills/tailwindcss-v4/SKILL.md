---
name: "TailwindCSS v4 Architect"
description: "Rules for developing and customizing styling using Tailwind CSS v4."
license: "Apache-2.0"
---

# Tailwind CSS v4 Skill

SCARline uses Tailwind CSS v4. Because v4 has major architectural shifts from v3, you must explicitly follow these rules.

## 1. CSS-First Configuration

Tailwind v4 is "CSS-first". 

- **NO Configuration Files**: Do not create or edit `tailwind.config.js` or `tailwind.config.ts`.
- **Global CSS**: All configuration and theming must be done via the main CSS file using CSS variables.

## 2. Imports and Initialization

Use the new import syntax in the root stylesheet:

```css
/* CORRECT v4 syntax */
@import "tailwindcss";

/* WRONG (v3 syntax) */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## 3. Theme Variables

Define custom tokens using CSS variables within the `@theme` block in your CSS file:

```css
@theme {
  --color-primary: #1d4ed8;
  --font-custom: "Inter", sans-serif;
  --spacing-4x: 4rem;
}
```

## 4. General Utilities

- Prefer modern, built-in utility classes over arbitrary values (`[]`) whenever possible.
- Trust that v4 natively supports modern CSS features (like CSS nesting, container queries, and logical properties). 
- Avoid outdated v3 specific plugins if Tailwind v4 has integrated those features natively.
