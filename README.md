# renovate-safety

A CLI tool to analyze dependency update PRs created by Renovate for breaking changes and potential impact on your codebase.

## Key Changes in Latest Version

- 🆕 **Default PR Commenting**: Analysis results are now posted to PRs by default
- 🔄 **Smart Duplicate Detection**: Avoids creating duplicate comments
- 🌏 **Japanese Language Support**: Full AI analysis in Japanese with `--language ja`
- ⚡ **Improved Performance**: Better fallback handling for LLM providers

## Features

- 📦 **Automatic package detection** from Renovate PRs or manual input
- 📋 **Changelog analysis** from npm registry and GitHub releases
- 🔍 **Breaking change detection** using pattern matching
- 🤖 **AI-powered summarization** with Claude CLI (Pro/Max), Anthropic API, or OpenAI
- 🔎 **Static code analysis** using ts-morph to find affected API usage
- 🔬 **Deep code analysis** - comprehensive usage patterns, file classification, and config detection
- 📊 **Risk assessment** with safe/low/review ratings
- 📝 **Markdown/JSON reports** for easy consumption
- 💬 **Smart PR commenting** - posts analysis to PR with duplicate detection
- 🌏 **Multi-language support** - English and Japanese AI summaries
- 💾 **Intelligent caching** to avoid redundant API calls
- 🏥 **Environment health check** with `doctor` command

## Supported Package Managers

### Full Support
- **JavaScript/TypeScript** (npm/yarn/pnpm)
  - Changelog fetching from npm registry and GitHub
  - TypeScript/JavaScript code analysis using ts-morph
  - Full breaking change detection

- **Python** (pip/poetry)
  - Changelog fetching from PyPI and GitHub
  - Python code analysis using regex-based scanning
  - Import and API usage detection

### Limited Support
Other package managers (Flutter pub, Gradle, etc.) have limited support:
- Basic version extraction from PR titles/body
- No language-specific code analysis
- Changelog fetching only if GitHub repository is detected

## Installation

### Global Installation (Recommended)
```bash
npm install -g renovate-safety
```

### Local Installation from Source
```bash
# Clone the repository
git clone https://github.com/chaspy/renovate-safety.git
cd renovate-safety

# Install dependencies and build
npm install
npm run build

# Link globally
npm link

# Now you can use it anywhere
renovate-safety doctor
```

### Run without Installation
```bash
npx renovate-safety --help
```

## Usage

### Basic Commands

Check environment setup:
```bash
renovate-safety doctor
```

Analyze all Renovate PRs (posts to each PR by default):
```bash
renovate-safety
```

Analyze a specific PR (posts comment by default):
```bash
renovate-safety --pr 123
```

Manual package specification:
```bash
renovate-safety --package @types/node --from 20.11.4 --to 20.11.5
```

### Advanced Options

```bash
renovate-safety analyze [options]

Options:
  -p, --pr <number>        Target PR number
  --from <version>         From version (manual override)
  --to <version>           To version (manual override)  
  --package <name>         Package name (manual override)
  --post <mode>            Post mode (default: always)
                           - always: Post new comment (skip if exists)
                           - update: Update existing comment
                           - never: Console output only
  --no-llm                 Skip AI summarization
  --llm <provider>         LLM provider (claude-cli|anthropic|openai)
  --cache-dir <path>       Cache directory (default: ~/.renovate-safety-cache)
  --json                   Output as JSON instead of Markdown
  --force                  Force analysis even for patch updates
  --language <lang>        Language for AI analysis (en|ja)
  -h, --help               Show help
```

### AI Provider Priority

The tool automatically detects and uses AI providers in this order:

1. **Claude CLI** - Automatically detected if installed (Pro/Max plan users)
2. **Anthropic API** - Uses `ANTHROPIC_API_KEY` environment variable
3. **OpenAI API** - Uses `OPENAI_API_KEY` environment variable

For GitHub features:
- `GITHUB_TOKEN` - for GitHub API access (optional, uses gh CLI as fallback)

### Configuration

Configuration can be set via (in order of precedence):
1. Command line arguments
2. Environment variables
3. Local config file (`.renovate-safety.json` in current directory)
4. Global config file (`~/.renovate-safety.json`)

#### Environment Variables
- `RENOVATE_SAFETY_LANGUAGE` - Set default language (en|ja)
- `RENOVATE_SAFETY_LLM_PROVIDER` - Set default LLM provider
- `RENOVATE_SAFETY_CACHE_DIR` - Set cache directory

#### Config File Example
```json
{
  "language": "ja",
  "llmProvider": "openai",
  "cacheDir": "/custom/cache/path"
}
```

## Examples

### Check environment setup
```bash
renovate-safety doctor
```

### PR Comment Management
```bash
# Default behavior: post new comment (skip if exists)
renovate-safety --pr 123

# Always update existing comment
renovate-safety --pr 123 --post update

# Console output only (no PR comment)
renovate-safety --pr 123 --post never

# Analyze all PRs and post to each
renovate-safety  # Uses --post always by default
```

**Comment Detection**: The tool looks for existing comments containing "Generated by [renovate-safety]" to avoid duplicates.

### Using API keys
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

### Deep code analysis for comprehensive insights
```bash
renovate-safety --pr 123 --deep
```

### Japanese language support
```bash
# Set via command line
renovate-safety --pr 123 --language ja

# Set via environment variable
export RENOVATE_SAFETY_LANGUAGE=ja
renovate-safety --pr 123

# Set via config file (~/.renovate-safety.json)
{
  "language": "ja"
}
```

## Risk Levels

- **✅ Safe**: No breaking changes detected, safe to merge
- **⚠️ Low**: Breaking changes found but no API usage in your code
- **🔍 Review**: Breaking changes affect APIs used in your codebase

## How It Works

1. **Package Detection**: Extracts package name and version changes from PR title/branch
2. **Changelog Fetching**: Downloads changelog from GitHub releases or npm registry
3. **Breaking Change Analysis**: Uses pattern matching to identify breaking changes
4. **AI Summarization**: Optional LLM analysis for better understanding (supports Japanese)
5. **Code Scanning**: Uses ts-morph to find usage of affected APIs
6. **Deep Analysis** (optional): Comprehensive code analysis including:
   - File classification (test vs production vs config)
   - Import analysis and usage patterns
   - Configuration file scanning
   - API usage type detection (function calls, property access, etc.)
   - Test coverage assessment
7. **Risk Assessment**: Combines all factors to determine risk level
8. **Report Generation**: Creates detailed Markdown or JSON reports
9. **PR Commenting**: Automatically posts analysis to PR with duplicate detection

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

## Requirements

- Node.js >= 18
- Git repository (runs from project root)
- One of:
  - Claude CLI (for Pro/Max users)
  - Anthropic API key
  - OpenAI API key
- GitHub CLI (optional, for PR features)

## Development

```bash
# Clone and setup
git clone https://github.com/chaspy/renovate-safety.git
cd renovate-safety
npm install

# Build
npm run build

# Test
npm test

# Lint and format
npm run lint
npm run format

# Type check
npm run typecheck

# Watch mode for development
npm run dev
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