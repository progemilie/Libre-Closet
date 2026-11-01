# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Libre Closet is a self-hosted wardrobe organizer: a NestJS 11 (Fastify) server-rendered MVC app using Handlebars views, htmx/\_hyperscript progressive enhancement, Tailwind + daisyUI, and MikroORM over SQLite (default) or PostgreSQL. Node version is in `.nvmrc` (22.x).

## Commands

```bash
npm run start:dev        # nest watch + tailwind watch (http://localhost:3000)
npm run build            # nest build (swc) + tailwind bundle + service worker (workbox)
npm run lint             # eslint --fix
npm run format           # prettier --write (src, test)
npm run test             # jest unit tests (*.spec.ts under src/)
npm run test:cov
npm run test:e2e:smoke   # playwright smoke test, chromium only
npm run precommit        # format, lint, test:cov, e2e smoke, build, load test, lighthouse
```

- Single unit test file: `npx jest src/auth/auth.service.spec.ts`. By name: `npx jest -t "test name"`.
- Single e2e test: `npx playwright test test/smoke.spec.ts --project=chromium`. Playwright's `webServer` runs `npm run build && npm run start:prod` on port 3000, or reuses a server that is already running there (outside CI).
- CI ([.github/workflows/github-actions-ci.yml](.github/workflows/github-actions-ci.yml)) runs the e2e smoke and load tests twice: once on SQLite with local storage, then on Postgres with S3 (MinIO). Changes to the data or file layers must work on both.
- `npm run precommit` is the final check before committing. Warnings are fine. Failures are not.

## Configuration

- `.env` holds committed defaults. `.env.local` (gitignored) overrides it. Every config key is validated, with defaults, by the Joi schema in [src/app.module.ts](src/app.module.ts).
- Read config through `ConfigService`, not `process.env`. The exceptions are `main.ts` and the static `driver` choice in [src/dal/dal.module.ts](src/dal/dal.module.ts), which is evaluated before config is available.
- A new config value needs a Joi entry with a sensible default and a row in the README configuration table.

## Architecture

**Request pipeline ([src/main.ts](src/main.ts)).** A Fastify `preHandler` hook fills `reply.locals` with `ViewContextService.buildContext()`: app name, auth/PWA flags, locale, OpenGraph fields, and the current `user` decoded from the `access_token` JWT cookie. Every view gets this context. An `onSend` hook sets the security headers, including a strict CSP. Do not add runtime CDN scripts. Client libraries are installed from npm and served from `node_modules` under `/modules/...` through `app.useStaticAssets` in `main.ts`. Handlebars helpers (`ifEquals`, `ifInArray`, `filterErrors`, `formatDate`, etc.) are also registered in `main.ts`.

**Full pages vs htmx partials.** Controllers render full pages with `@Render('dir/view')`, which uses `views/layout.hbs`. For htmx requests they check `req.headers['hx-request']` and return `reply.viewPartial('partials/...', data)`. This is a second `@fastify/view` instance with no layout (typed in [src/types/fastify.d.ts](src/types/fastify.d.ts)). Partials in `views/partials/` are registered globally. `ErrorViewFilter` (the global `APP_FILTER`) renders every exception as the `error` view.

**Optional auth.** `AUTH_ENABLED=false` is the default single-user mode.
- `ConditionalAuthGuard` is used on the app's feature controllers. When auth is off it lets every request through. When auth is on it verifies the JWT and redirects to `/auth/login` on failure.
- `AuthGuard` throws 404 when auth is off and 401 when the user is not authenticated.
- The user id is read from `req['user']` (`Payload.userId`) and may be `undefined`. Services therefore scope queries as `{ owner: { id: userId } }` when there is a user, or `{ owner: null }` when there is not. Keep both branches working.

**Wardrobe sharing.** `WardrobeShare` grants another user `VIEW` or `MANAGE` permission on a grantor's wardrobe. Wardrobe, outfit, and calendar routes take an `ownerId` query param. Controllers check it with `WardrobeShareService.canView` / `canManage` / `getSharePermission` before calling services with a `viewOwner`. Services then allow access when the entity belongs to `userId` or to the permitted `viewOwner`.

**Modules.**
- `src/dal/` holds entities and migrations.
- `src/wardrobe/` holds garments, outfits, and the outfit calendar, with view-models for the calendar/week schedule.
- `src/wardrobe-share/`, `src/weather/` (Open-Meteo, cached via cache-manager), `src/file/`, `src/auth/`, `src/email/`, `src/notification/` (web push), and `src/open-graph/` cover the remaining features.
- `FileService` is an abstract provider. `FileModule` resolves it to `LocalFileService` or `S3FileService` based on `FILE_STORAGE_TYPE`.
- Image background removal runs in the browser (`public/js/background-removal.js`, @imgly). `patches/` holds a patch-package fix for it.

**Database and migrations.**
- Migrations run automatically at startup (`AppModule.onModuleInit` → `orm.migrator.up()`).
- SQLite and Postgres have separate migration folders and snapshots. Any entity change needs a migration in both:
  - SQLite: `npm run build`, then `npx mikro-orm migration:create --config mikro-orm.sqlite.cli-config.ts`
  - Postgres: `npx mikro-orm migration:create --config mikro-orm.postgres.cli-config.ts`. This needs a local Postgres with the credentials in that config file.
- SQLite column changes produce table rebuilds. Inside a transaction, `DROP TABLE` fires `ON DELETE CASCADE` even with `foreign_keys = off`, which once wiped `outfit_garments` (#129). [src/dal/sqlite-migrations.spec.ts](src/dal/sqlite-migrations.spec.ts) seeds data and runs every SQLite migration, asserting no table loses rows. Review generated SQLite migrations with this in mind.

**i18n.** nestjs-i18n uses the `AcceptLanguageResolver`. Locale files are `src/i18n/<lang>/lang.json`, and `en` is the source of truth. Every user-facing string must come from them:
- In views: `{{t 'lang.KEY'}}`
- In controllers: the `@I18n() i18n: I18nContext` parameter
- DTO validation messages: also from the locale files

Add new keys to every locale file. In non-production runs the app regenerates `src/generated/i18n.generated.ts`, so don't edit that file by hand.

**Frontend assets.**
- `views/assets/main.css` is compiled to `public/bundle.css` by the Tailwind CLI.
- `views/assets/src-sw.ts` is bundled with esbuild, then workbox injects the precache manifest.
- Static files live in `public/`.

## Project conventions

These come from [.github/prompts/boilerplate.prompt.md](.github/prompts/boilerplate.prompt.md) and [.github/agents/TDD.agent.md](.github/agents/TDD.agent.md):

- Server-side rendering first. Don't add client-side logic that duplicates what the server can render. Use htmx or \_hyperscript only where they clearly add value. Prefer \_hyperscript over inline vanilla JS, and use standard daisyUI components.
- Extracting reusable front-end code into `public/js/` needs explicit approval from the user.
- Locality of behavior: keep definitions next to where they are used. Extract only when something is used in more than one place.
- Don't add or change documentation files without approval. Documentation that doesn't fit the README goes in `docs/`. Check work against [docs/DESIGN.md](docs/DESIGN.md).
- Feature work follows TDD. Write a failing test first, usually Playwright in `test/`, or a Nest `Test.createTestingModule` unit test with mocks. Then make it pass, then run `npm run precommit`.
- Once a feature passes, add a one-line, non-technical entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).
