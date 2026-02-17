---
name: backend-nestjs
description: NestJS backend development patterns. Use when developing backend APIs with NestJS, TypeORM/Prisma, and TypeScript.
triggers: [nestjs, nest, backend, api, typescript backend, typeorm, prisma]
---

# NestJS Backend Development

## When to Use This Skill

Use when developing backend code in a NestJS project with TypeScript.

## Recommended Project Structure

```
src/
├── core/
│   ├── config/              # Configuration (env validation)
│   ├── database/            # Database connections, migrations
│   ├── guards/              # Auth guards
│   ├── interceptors/        # Request/response interceptors
│   ├── filters/             # Exception filters
│   └── decorators/          # Custom decorators
├── modules/
│   └── <domain>/
│       ├── application/     # Use cases / services
│       ├── domain/          # Entities, value objects, interfaces
│       ├── infrastructure/  # Repositories, external services
│       ├── presentation/    # Controllers, DTOs, validators
│       └── <domain>.module.ts
├── shared/
│   ├── utils/
│   ├── types/
│   └── constants/
└── main.ts
```

## Conventions

- One use case per file in `application/`
- DTOs with class-validator decorators in `presentation/`
- Repository pattern for data access in `infrastructure/`
- Module-scoped providers; export only what's needed

## Testing

- Stack: Vitest (preferred) or Jest
- Unit test use cases with mocked dependencies
- Test file next to source: `*.spec.ts`
- All tests in English
- Naming: "should do X when Y"

## Commands

```bash
pnpm dev          # Development with hot reload
pnpm build        # Production build
pnpm lint         # ESLint
pnpm test         # Run tests
pnpm test:cov     # Coverage report
```

## Error Handling

- Use NestJS built-in exceptions (BadRequestException, NotFoundException, etc.)
- Custom exceptions extend HttpException
- Global exception filter for unhandled errors

## Database

- Use query builder or repository pattern
- Always use transactions for multi-table writes
- Add indexes for frequently queried columns
- Use database MCPs to inspect schema before writing queries

## Pre-commit Checklist

- Build passes? (`pnpm build`)
- Lint passes? (`pnpm lint`)
- Tests pass? (`pnpm test`)
- DTOs have proper validation?
- Error cases handled?
