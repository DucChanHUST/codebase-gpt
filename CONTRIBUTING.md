# Contributing to codebase-gpt

Thank you for your interest in contributing! 🎉

## Quick Start

1. **Fork** the repo on GitHub
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/codebase-gpt.git
   cd codebase-gpt
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## Development

```bash
npm run build        # Build
npm test             # Run tests
npm run test:watch   # Watch mode
npm run lint         # Lint
npm run typecheck    # TypeScript checks
```

## Submitting a Pull Request

1. Ensure all tests pass: `npm test`
2. Add tests for new functionality
3. Update documentation if needed
4. Push to your fork: `git push origin feature/your-feature-name`
5. Open a PR against `main` on [phoenix-assistant/codebase-gpt](https://github.com/phoenix-assistant/codebase-gpt)

## PR Guidelines

- **One PR per feature/fix** — keep changes focused
- **Write meaningful commit messages** — use [Conventional Commits](https://www.conventionalcommits.org/)
- **Add/update tests** — coverage should not decrease
- **Update README** if adding new CLI flags or behavior

## Reporting Issues

Use the [GitHub Issues](https://github.com/phoenix-assistant/codebase-gpt/issues) tracker. Please:
- Search existing issues before opening a new one
- Include steps to reproduce, expected vs. actual behavior
- Include Node.js version, OS, and tool version

## Code Style

- TypeScript strict mode
- ESLint + Prettier (run `npm run lint:fix`)
- Test files alongside source files

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
