# AGENTS.md

## Before You Start
- Read `ARCHITECTURE.md` for project structure and concepts
- Run `npm test` and `npm run lint` to verify everything works before making changes

## Running the Project

```bash
npm test              # Run tests
npm run lint          # Lint code
roadtripper plan <path>      # Start planner at http://localhost:5173
roadtripper navigate <path>  # Run navigation
roadtripper navigate <path> --debug   # Debug mode (visible browser + devtools)
```

## Adding Features

1. Pure logic → `navigator/lib.js`
2. I/O/side effects → `navigator/index.js`
3. CLI commands → `cli.js`
4. Always add tests alongside new code

## Testing Requirements

- Uses Node.js built-in test runner: `node --test`
- Test utilities in `navigator/test-utils.js`: `createMockFs()`, `createMockPage()`, `mockPanoData()`
- Run tests before committing

## Code Style

- ES modules (`import`/`export`)
- Strict equality (`===`/`!==`)
- Async/await for all I/O
- Pure functions in `lib.js`, side effects in main modules
- Logging: Consola in navigator, `console` in CLI

## Security

- Never commit API keys or secrets
- Planner embeds Google Maps API key in client-side bundle — do not expose to public internet (see README security warning)

## Before Committing

1. Run `npm test`
2. Run `npm run lint`
3. No `console.log` statements — use Consola in navigator, `console` in CLI
