# Repository Guidelines

## Project Structure & Module Organization
This repository is currently a minimal scaffold with no application code checked in yet. Keep the root directory clean and add new work under clear top-level folders:

- `src/` for application code
- `tests/` for automated tests
- `assets/` for static files such as images or fixtures
- `docs/` for design notes or operational documentation

Group features by module name inside `src/` (for example, `src/mail/` or `src/auth/`). Mirror that structure in `tests/` so related code and tests stay easy to navigate.

## Build, Test, and Development Commands
There is no build system configured yet. When adding one, document the command set in the project manifest and keep these entry points stable:

- `npm install` or equivalent: install dependencies
- `npm run dev`: start a local development server or watcher
- `npm test`: run the full automated test suite
- `npm run lint`: run formatting and lint checks

If the project uses another toolchain, expose similar commands through a single documented interface.

## Coding Style & Naming Conventions
Use 4 spaces for indentation unless the chosen formatter enforces another standard. Prefer small, single-purpose modules. Use:

- `snake_case` for filenames when working in Python-oriented codebases
- `kebab-case` for web asset filenames
- `PascalCase` for classes and UI components
- `camelCase` for variables and functions in JavaScript or TypeScript

Adopt an autoformatter and linter early, and run them before opening a pull request.

## Testing Guidelines
Place tests in `tests/` and name them to match the unit under test, such as `tests/test_mail_parser.py` or `tests/auth/login.spec.ts`. Add at least one automated test for each new feature or bug fix. Prefer fast unit tests first, then integration tests for workflow-level behavior.

## Commit & Pull Request Guidelines
No Git history is present in this workspace, so no repository-specific commit convention can be inferred. Use short, imperative commit subjects such as `Add mail parser skeleton` or `Fix login validation`. Keep pull requests focused and include:

- a brief summary of the change
- test evidence or commands run
- linked issue or task, if available
- screenshots only when UI behavior changes

## Configuration Notes
Do not commit secrets, local `.env` files, or generated artifacts. Add new environment variables to a checked-in example file such as `.env.example`.
