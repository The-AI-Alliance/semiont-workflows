# Semiont Workflows Demo

Configuration-driven demonstration of [Semiont](https://github.com/The-AI-Alliance/semiont) SDK features: document processing, chunking, annotations, and validation.

> **About Semiont**: A semantic annotation and knowledge extraction platform developed by [The AI Alliance](https://thealliance.ai/). This demo repository showcases Semiont's capabilities using published artifacts. For development and contributing, see the [main Semiont repository](https://github.com/The-AI-Alliance/semiont).

## Quick Start

Launch the complete demo environment with one click (no installation required):

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-workflows)

**What's included:**

- Semiont frontend, backend, and database (all pre-configured)
- Envoy proxy for production-like routing
- Demo admin account with sample data
- Interactive terminal UI for dataset operations
- Ready in ~2 minutes

**After launch:**

1. Make port **8080** public (Ports tab → right-click → Public)
2. Visit the URL shown in the terminal
3. Login with the demo credentials displayed
4. Run `npm run demo:interactive` to explore datasets

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

> **Note**: Dataset configurations are stored in the [structured-knowledge](https://github.com/The-AI-Alliance/structured-knowledge) repository (linked as a git submodule). GitHub Codespaces automatically initializes submodules. For local setup, see the setup guide.

## Demo Modes

### Interactive Terminal UI

```bash
npm run demo:interactive
```

Full-screen interface with three panels:

- **Left**: Dataset list with command tree
- **Bottom**: Detail view (dataset config/status)
- **Right**: Activity log (output)

**Controls:** `↑/↓` or `j/k` (navigate), `Enter` (execute), `Tab` (switch panels), `q` (quit)

See [docs/INTERACTIVE.md](docs/INTERACTIVE.md) for details.

### CLI Mode

```bash
npm run demo -- <dataset> <command>
```

**Available datasets:**

- `citizens_united` - Supreme Court case (legal citations)
- `prometheus_bound` - Ancient Greek play
- `freelaw_nh` - New Hampshire case law
- `arxiv` - Scientific papers
- `hiking` - Outdoor guides
- Private datasets in `structured-knowledge/scenarios/private/`

**Commands:**

- `download` - Fetch content, cache locally
- `load` - Process, upload to backend, create table of contents
- `annotate` - Detect patterns, create annotations
- `validate` - Verify resources, show checksums

**Example:**

```bash
npm run demo -- citizens_united download
npm run demo -- citizens_united load
npm run demo -- citizens_united annotate
npm run demo -- citizens_united validate
```

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the four-phase workflow details.

## Example Output

```text
📚 CITIZENS UNITED Demo
════════════════════════════════════════════

🔐 Authentication
   ✅ Authenticated as dev-xxxxx@example.com

📥 Download
   ✅ Downloaded 123,456 characters

📤 Load
   ✅ Created 5 chunks (avg 24,691 chars)
   ✅ Created ToC with 5 references

🔍 Annotate
   ✅ Detected 23 legal citations

✓ Validate
   ✅ ToC: text/html [sha256:a1b2c3...]
   ✅ Chunk 1: text/markdown [sha256:d4e5f6...]

📋 Table of Contents:
   http://localhost:8080/en/know/resource/abc123...
```

## Architecture

All traffic flows through Envoy proxy on port 8080 for production-like routing:

```text
Browser → http://localhost:8080 (Envoy) → Routes to Frontend/Backend
Demo Scripts → http://backend:4000 (Direct Docker network access)
```

See [docs/ENVOY.md](docs/ENVOY.md) for routing details and [docs/CONTAINER.md](docs/CONTAINER.md) for container architecture.

## Documentation

**Getting Started:**

- [Setup Guide](docs/SETUP.md) - Installation and first steps
- [Interactive UI](docs/INTERACTIVE.md) - Terminal interface reference
- [Workflow Guide](docs/WORKFLOW.md) - Four-phase processing workflow

**Architecture:**

- [Envoy Routing](docs/ENVOY.md) - Proxy configuration and troubleshooting
- [Container Details](docs/CONTAINER.md) - Devcontainer internals

**Configuration:**

- [Dataset Configuration](https://github.com/The-AI-Alliance/structured-knowledge/blob/main/scenarios/README.md) - Adding and configuring datasets
- [Semiont API Client](https://github.com/The-AI-Alliance/semiont/tree/main/packages/api-client) - TypeScript SDK reference

## Project Structure

```text
semiont-workflows/
├── demo.ts                   # Main entry point
├── src/                      # Reusable modules
│   ├── auth.ts              # Authentication
│   ├── annotations.ts       # Annotation creation/linking
│   ├── chunking.ts          # Text chunking
│   ├── resources.ts         # Upload & ToC creation
│   ├── validation.ts        # Resource validation
│   └── terminal-app.ts      # Interactive UI
├── structured-knowledge/     # Dataset configurations (git submodule)
│   └── scenarios/           # YAML configs for each dataset
│       ├── citizens_united/
│       ├── freelaw_nh/
│       └── private/         # Private datasets (gitignored)
├── src/types.ts             # Config type definitions
├── docs/                     # Documentation
│   ├── SETUP.md             # Setup guide
│   ├── ENVOY.md             # Routing architecture
│   ├── WORKFLOW.md          # Processing workflow
│   ├── INTERACTIVE.md       # Terminal UI reference
│   └── CONTAINER.md         # Container details
└── .devcontainer/           # Development environment
    ├── docker-compose.yml   # Service orchestration
    ├── envoy.yaml           # Envoy routing config
    └── setup-demo.sh        # Initialization script
```

## Contributing

This is a demo repository showcasing Semiont. For contributions to Semiont itself, please see the [main Semiont repository](https://github.com/The-AI-Alliance/semiont).

For improvements to this demo:

- Issues and pull requests are welcome
- Please follow our [Code of Conduct](CODE_OF_CONDUCT.md)
- See [LICENSE](LICENSE) for licensing information

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
