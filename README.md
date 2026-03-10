# Semiont Workflows

Turn documents into structured, annotated knowledge graphs.

[Semiont](https://github.com/The-AI-Alliance/semiont) is a semantic annotation and knowledge extraction platform from [The AI Alliance](https://thealliance.ai/). This repository demonstrates its core capabilities: ingesting documents from diverse sources, chunking them intelligently, creating semantic annotations that capture meaning and relationships, and validating the resulting knowledge structures.

## What You Can Do

**Ingest documents from anywhere** -- Supreme Court opinions from Cornell LII, scientific papers from arXiv, case law from FreeLaw, or your own private collections. Semiont normalizes them into a common format with content-addressed integrity (SHA-256 checksums on every chunk).

**Create semantic annotations automatically** -- pattern detection identifies legal citations, cross-references, and domain-specific entities, then links them back to precise positions in the source text. The annotation layer is extensible: write custom detectors for any domain.

**Build navigable knowledge structures** -- documents become Tables of Contents with linked chunks, annotations become edges in a knowledge graph. Browse the results in Semiont's web UI or query them programmatically via the TypeScript API client.

**Validate everything** -- every resource is content-addressed and verifiable. The validation phase fetches resources back from the API, recomputes checksums, and confirms integrity end-to-end.

## Getting Started

### GitHub Codespaces (fastest)

Launch a complete environment with no local installation:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-workflows)

See [.devcontainer/README.md](.devcontainer/README.md) for Codespaces and devcontainer details.

### Local Setup

Run Semiont locally using published npm packages -- no repo clone needed. See the [Local Semiont](https://github.com/The-AI-Alliance/semiont/blob/main/docs/LOCAL-SEMIONT.md) guide in the main Semiont repository.

After completing the local setup and creating an admin user, configure the demo scripts with your credentials:

```bash
cp .env.example .env
```

Edit `.env` and set `AUTH_EMAIL` and `AUTH_PASSWORD` to the admin credentials you created. The other defaults (`SEMIONT_URL`, `DATA_DIR`, etc.) are appropriate for a standard local setup.

## Running the Demo

Once Semiont is running (via either Codespaces or local setup), process datasets through the four-phase workflow. The demo scripts authenticate using credentials from a `.env` file -- Codespaces generates this automatically; for local setup, see the instructions above.

The interactive terminal UI provides a full-screen interface for exploring all available datasets and commands. Navigate with arrow keys or `j`/`k`, execute with `Enter`, switch panels with `Tab`, quit with `q`. See [docs/INTERACTIVE.md](docs/INTERACTIVE.md) for the full reference.

```bash
npm run demo:interactive
```

Or run individual phases on any dataset from the command line:

```bash
npm run demo -- <dataset> <command>
```

The four commands -- `download`, `load`, `annotate`, `validate` -- are designed to run in sequence. Each phase is idempotent: re-running it will overwrite previous results. For example, processing the Citizens United opinion:

```bash
npm run demo -- citizens_united download   # Fetch the opinion from Cornell LII
npm run demo -- citizens_united load       # Chunk, upload, create Table of Contents
npm run demo -- citizens_united annotate   # Detect 23 legal citations, link to text
npm run demo -- citizens_united validate   # Verify every resource and checksum
```

After loading, open http://localhost:8080 to browse the results in Semiont's web UI. See [docs/WORKFLOW.md](docs/WORKFLOW.md) for details on each phase.

### Included Datasets

| Dataset | Source | What It Demonstrates |
|---------|--------|---------------------|
| `citizens_united` | Cornell LII | Legal citation detection and cross-referencing |
| `prometheus_bound` | Public domain | Literary text chunking and annotation |
| `freelaw_nh` | FreeLaw Project | Multi-document case law processing |
| `arxiv` | arXiv.org | Scientific paper ingestion |
| `hiking` | Outdoor guides | General-purpose document processing |

Dataset configurations live in the [structured-knowledge](https://github.com/The-AI-Alliance/structured-knowledge) repository, included here as a git submodule. GitHub Codespaces initializes submodules automatically; for local setup, run `git submodule update --init`. Private datasets can be added under `structured-knowledge/scenarios/private/`.

## Documentation

- [Workflow Guide](docs/WORKFLOW.md) - The four-phase processing pipeline (download, load, annotate, validate)
- [Interactive UI](docs/INTERACTIVE.md) - Terminal interface reference
- [Local Setup](https://github.com/The-AI-Alliance/semiont/blob/main/docs/LOCAL-SEMIONT.md) - Running Semiont locally
- [Envoy Routing](docs/ENVOY.md) - Proxy configuration
- [Container Details](docs/CONTAINER.md) - Devcontainer architecture
- [Dataset Handlers](docs/HANDLERS.md) - How config.yaml files are consumed and processed
- [Dataset Configuration](https://github.com/The-AI-Alliance/structured-knowledge/blob/main/scenarios/README.md) - Adding and configuring datasets
- [Semiont API Client](https://github.com/The-AI-Alliance/semiont/tree/main/packages/api-client) - TypeScript SDK reference

## Contributing

For contributions to Semiont itself, see the [main Semiont repository](https://github.com/The-AI-Alliance/semiont). For improvements to this demo, issues and pull requests are welcome. See [LICENSE](LICENSE) for licensing information.
