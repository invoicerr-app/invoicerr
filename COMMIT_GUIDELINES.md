# Commit Guidelines for Invoicerr

This document defines the commit message conventions for the Invoicerr project.

## Commit Message Format

```
<emoji> <type>[(scope)]: <description>

[optional body]

[optional footer(s)]
```

## Types and Emojis

| Emoji | Type | Description |
|-------|------|-------------|
| ✨ | `feat` | New feature |
| 🐛 | `fix` | Bug fix |
| 📝 | `docs` | Documentation only changes |
| 💄 | `style` | Code style (formatting, semicolons, etc.) |
| ♻️ | `refactor` | Code refactoring |
| ⚡️ | `perf` | Performance improvements |
| ✅ | `test` | Adding or correcting tests |
| 🔧 | `chore` | Build process or auxiliary tool changes |
| 🔥 | `remove` | Removing code or files |
| 🌐 | `i18n` | Internationalization and translations |
| 💚 | `ci` | CI/CD changes |
| 🚀 | `deploy` | Deployment related changes |
| 🔒 | `security` | Security improvements |
| 📦 | `deps` | Dependency updates |

## Scopes (optional but recommended)

Common scopes for this project:
- `frontend` - Frontend React code
- `backend` - Backend NestJS code
- `api` - API endpoints
- `ui` - UI components
- `db` - Database/Prisma changes
- `auth` - Authentication related
- `e2e` - E2E tests
- `compliance` - Compliance/country-specific features
- `multi-tenant` - Multi-tenancy features
- `docs` - Documentation

## Examples

### Simple feature
```
✨ feat: Add invoice PDF download button
```

### Feature with scope
```
✨ feat(compliance): Add Poland KSeF integration

Backend:
- Add Poland country config with KSeF clearance model
- Add KSeF transmission strategy with qualified certificate auth

Frontend:
- Add corrective invoice page
- Add invoice modification dialog component
```

### Bug fix with details
```
🐛 fix(multi-tenant): Fix invitation flow adding users to company

- Fix markInvitationAsUsed to also add users to company
- Fix E2E test selectors for admin pages
- Fix company submit button visibility

All 27 E2E multi-tenant tests now pass.
```

### Refactoring
```
♻️ refactor(frontend): Update form, hooks and types

- Migrate to React Hook Form v7
- Update TypeScript types for better inference
- Extract reusable validation schemas
```

### Multiple changes in one commit
```
✨ feat: Implement admin layout and user management
🌐 i18n: Add translations for admin navigation and user roles
🔧 config: Update routing to include invitation handling
💚 ci-fix: Add types for user and company roles
```

## Rules

1. **Use present tense** - "Add feature" not "Added feature"
2. **Lowercase after colon** - "feat: add button" not "feat: Add button"
3. **No period at end** of the first line
4. **Body is optional** but encouraged for complex changes
5. **Reference issues** when applicable: "Fixes #123"
6. **Include Co-Authored-By** when AI assists significantly

## When AI Assists

Add to the footer when an AI assistant contributes significantly. The AI should identify itself with its current model name:

```
Co-Authored-By: [AI Model Name] <noreply@[provider].com>
```

Examples of model identifiers:
- `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
- `Co-Authored-By: Gemini <noreply@google.com>`
- `Co-Authored-By: Kimi K2.5 <noreply@kimi.com>`

The AI should add this footer when it has:
- Written significant portions of the code
- Made architectural decisions
- Fixed complex bugs
- Generated configuration or documentation

## Pre-commit Checklist

Before committing, ensure:
- [ ] Code follows project conventions (Biome/ESLint pass)
- [ ] Tests pass (`npm run test` in relevant directory)
- [ ] TypeScript compiles without errors
- [ ] Commit message follows this format
- [ ] Scope is appropriate for the change
