---
name: frontend-nextjs
description: NextJS frontend development patterns. Use when developing frontend code with NextJS, React, Tailwind, and TypeScript.
triggers: [nextjs, next, react, frontend, tailwind, typescript frontend, ui, components]
---

# NextJS Frontend Development

## When to Use This Skill

Use when developing frontend code in a NextJS project with React, Tailwind, and TypeScript.

## Recommended Project Structure

```
src/
├── app/                    # Routes, layouts, server components
├── components/
│   ├── ui/                 # Design system primitives (shadcn/ui)
│   ├── common/             # Reusable generic components
│   ├── layout/             # Header, Footer, Sidebar
│   └── icons/
├── features/
│   └── <domain>/
│       ├── components/
│       ├── hooks/
│       ├── stores/
│       ├── services/
│       ├── constants/
│       └── types/
├── shared/
│   ├── hooks/
│   ├── utils/
│   ├── stores/
│   ├── services/
│   ├── constants/
│   └── types/
└── styles/
```

## Organization Rules

- `components/ui` — Design system primitives only
- `components/common` — Generic components used across features
- `features/<domain>` — Domain-specific UI and logic (isolated)
- `shared/*` — Truly global hooks, utils, services
- `app/*` — Pages, layouts, data fetching; no business logic

## Import Order

1. `@/components/ui`
2. `@/components/common`
3. `@/features/<domain>`
4. `@/shared/...`

Features must NOT import from other features.

## Naming Conventions

- Folders and files: kebab-case
- Hooks: `use-` prefix
- Stores: `-store.ts` suffix
- Types: feature-local; export only when necessary

## State & Data

- Server Components by default; `'use client'` only when necessary
- Data fetching in `app/*` or `features/<domain>/services`
- Global state only when crossing features; otherwise keep local

## Styles (Tailwind)

- Use `cn` helper (clsx + tailwind-merge) for conditional classes
- Mobile first approach
- Class order: layout -> box model -> typography -> visual -> states
- Avoid inline `style={{}}`

## Testing

- Stack: Vitest + Testing Library + MSW
- Test hooks, stores, services, components with real interactions
- Don't test: "renders without crash", CSS, third-party UI
- Naming: "should do X when Y"
- All tests in English

## Pre-commit Checklist

- File in correct directory?
- Imports follow allowed graph?
- `'use client'` only where needed?
- State properly localized?
- Tailwind formatted, no inline styles?
- Minimum accessibility applied?
