# renovate-safety

A CLI tool to analyze dependency update PRs created by Renovate for breaking changes and potential impact on your codebase.

## Features

- 📦 **Automatic package detection** from Renovate PRs or manual input
- 📋 **Changelog analysis** from npm registry and GitHub releases
- 🔍 **Breaking change detection** using pattern matching
- 🤖 **AI-powered summarization** with Claude (Anthropic) or OpenAI o3
- 🔎 **Static code analysis** using ts-morph to find affected API usage
- 📊 **Risk assessment** with safe/low/review ratings
- 📝 **Markdown/JSON reports** for easy consumption
- 💬 **PR comment posting** via GitHub CLI
- 💾 **Intelligent caching** to avoid redundant API calls

## Installation

```bash
npm install -g renovate-safety
```

Or run directly with npx:

```bash
npx renovate-safety --help
```

## Usage

### Basic Usage

Analyze a specific PR:
```bash
renovate-safety --pr 123
```

Analyze current branch:
```bash
renovate-safety
```

Manual package specification:
```bash
renovate-safety --package @types/node --from 20.11.4 --to 20.11.5
```

### Advanced Options

```bash
renovate-safety [options]

Options:
  -p, --pr <number>        Target PR number
  --from <version>         From version (manual override)
  --to <version>           To version (manual override)  
  --package <name>         Package name (manual override)
  --post                   Post report as PR comment
  --no-llm                 Skip AI summarization
  --llm <provider>         LLM provider (anthropic|openai)
  --cache-dir <path>       Cache directory (default: ~/.renovate-safety-cache)
  --json                   Output as JSON instead of Markdown
  --force                  Force analysis even for patch updates
  -h, --help               Show help
```

### Environment Variables

For AI analysis, set one of:
- `ANTHROPIC_API_KEY` - for Claude (Anthropic)
- `OPENAI_API_KEY` - for OpenAI o3

For GitHub features:
- `GITHUB_TOKEN` - for GitHub API access (optional, uses gh CLI as fallback)

## Examples

### Analyze and post to PR
```bash
export ANTHROPIC_API_KEY=your_key_here
renovate-safety --pr 123 --post
```

### JSON output for CI/CD
```bash
renovate-safety --pr 123 --json > analysis.json
```

### Force analysis of patch updates
```bash
renovate-safety --pr 123 --force
```

### Skip AI analysis for faster results
```bash
renovate-safety --pr 123 --no-llm
```

## Risk Levels

- **✅ Safe**: No breaking changes detected, safe to merge
- **⚠️ Low**: Breaking changes found but no API usage in your code
- **🔍 Review**: Breaking changes affect APIs used in your codebase

## How It Works

1. **Package Detection**: Extracts package name and version changes from PR title/branch
2. **Changelog Fetching**: Downloads changelog from GitHub releases or npm registry
3. **Breaking Change Analysis**: Uses pattern matching to identify breaking changes
4. **AI Summarization**: Optional LLM analysis for better understanding
5. **Code Scanning**: Uses ts-morph to find usage of affected APIs
6. **Risk Assessment**: Combines all factors to determine risk level
7. **Report Generation**: Creates detailed Markdown or JSON reports

## Supported Patterns

The tool recognizes common breaking change indicators:
- `BREAKING CHANGE:` / `BREAKING:`
- `[BREAKING]` / `💥`
- `* Removed` / `* Deleted`
- `DEPRECATED:` / `[DEPRECATED]`
- `MIGRATION REQUIRED`
- `INCOMPATIBLE` / `NOT BACKWARD COMPATIBLE`

## Cache

Results are cached in `~/.renovate-safety-cache/` by default:
- Changelog diffs
- LLM summaries (keyed by package@from->to)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Type check
npm run typecheck
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

ISC

## Related

- [Renovate](https://docs.renovatebot.com/) - Automated dependency updates
- [GitHub CLI](https://cli.github.com/) - Required for PR operations