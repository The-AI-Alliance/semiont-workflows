# Semiont Workflows Demo Devcontainer

Production-ready demo environment that uses published [Semiont](https://github.com/The-AI-Alliance/semiont) containers and packages.

> **About Semiont**: A semantic annotation and knowledge extraction platform developed by [The AI Alliance](https://thealliance.ai/). This demo repository showcases Semiont's capabilities using published artifacts. For development and contributing, see the [main Semiont repository](https://github.com/The-AI-Alliance/semiont).

## Quick Start

### GitHub Codespaces (Recommended)

Click to launch the Semiont Workflows Demo:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-workflows)

### Local Development

```bash
# Clone this demo repository
git clone https://github.com/The-AI-Alliance/semiont-workflows.git
cd semiont-workflows

# Open in VS Code with Dev Containers extension
code .

# When prompted, select "Reopen in Container"
# Or: Cmd/Ctrl+Shift+P → "Dev Containers: Reopen in Container"
```

## What's Included

All components are **published artifacts** (not built from source):

- **Semiont Frontend** (`ghcr.io/the-ai-alliance/semiont-frontend:latest`)
  - Web UI at http://localhost:3000

- **Semiont Backend** (`ghcr.io/the-ai-alliance/semiont-backend:latest`)
  - API server at http://localhost:4000

- **PostgreSQL** (`postgres:16-alpine`)
  - Database at localhost:5432

- **@semiont/cli** (`latest`)
  - Command-line tool (globally installed)

- **@semiont/api-client** (`latest`)
  - TypeScript SDK (in node_modules)

## Setup Process

After container creation (~1-2 minutes):

1. **Services start** - Frontend, backend, and database containers
2. **CLI installed** - `@semiont/cli@latest` globally
3. **Dependencies installed** - Demo scripts and API client
4. **Demo user created** - Email: `demo@example.com`, Password: `demo123`
5. **Configuration saved** - Credentials stored in `.env`

## Usage

### Web Interface

1. Visit http://localhost:3000
2. Login with demo credentials:
   - Email: `demo@example.com`
   - Password: `demo123`
3. Explore the Semiont UI

### Interactive Demo Terminal

```bash
npm run demo:interactive
```

Full-screen terminal interface for running demo commands.

### CLI Commands

```bash
# Check CLI version
semiont --version

# Run demo scripts
npx tsx demo.ts citizens_united download
npx tsx demo.ts citizens_united load
npx tsx demo.ts citizens_united annotate
```

## Configuration

### Environment Variables

Configuration is in `.env` (auto-created during setup).

To customize:

```bash
# Edit environment variables
nano .env

# Restart services to apply changes
docker compose restart backend frontend
```

### Optional Features

To enable AI-powered annotation or graph features:

1. Copy template: `cp .devcontainer/.env.template .devcontainer/.env`
2. Add your API keys:
   - `ANTHROPIC_API_KEY` - Get from https://console.anthropic.com/settings/keys
   - Neo4j credentials - Get from https://neo4j.com/cloud/aura/
3. Rebuild container: Cmd/Ctrl+Shift+P → "Dev Containers: Rebuild Container"

## Version Management

### Update to New Release

When updating to a new Semiont version, update the version number in all of these files:

1. **`.devcontainer/docker-compose.yml`** - SEMIONT_VERSION environment variable
2. **`.devcontainer/devcontainer.json`** - containerEnv and remoteEnv SEMIONT_VERSION values
3. **`.devcontainer/setup-demo.sh`** - SEMIONT_VERSION variable
4. **`package.json`** - @semiont/api-client and @semiont/cli dependency versions

After updating all version references:

1. Rebuild container:
   ```bash
   # In VS Code: Cmd/Ctrl+Shift+P → "Dev Containers: Rebuild Container"
   # Or manually:
   docker compose down
   docker compose pull
   docker compose up -d
   ```

2. Run setup script to install updated dependencies:
   ```bash
   bash .devcontainer/setup-demo.sh
   ```

### Test Development Builds

To test latest development build (unstable):

```bash
# In .devcontainer/.env
SEMIONT_VERSION=dev
```

Then rebuild container.

## Troubleshooting

### Services Not Starting

Check service logs:

```bash
# All services
docker compose logs

# Specific service
docker compose logs backend
docker compose logs frontend
docker compose logs postgres
```

### Backend Health Check Fails

```bash
# Check backend status
docker compose ps backend

# View backend logs
docker compose logs backend

# Restart backend
docker compose restart backend

# Check health endpoint
curl http://localhost:4000/health
```

### Frontend Not Accessible

```bash
# Check frontend status
docker compose ps frontend

# View frontend logs
docker compose logs frontend

# Restart frontend
docker compose restart frontend
```

### Database Connection Issues

```bash
# Check PostgreSQL status
docker compose ps postgres

# Connect to database
docker compose exec postgres psql -U semiont -d semiont_demo

# View database logs
docker compose logs postgres
```

### Reset Everything

```bash
# Stop and remove all containers and volumes
docker compose down -v

# Pull latest images
docker compose pull

# Start fresh
docker compose up -d

# Re-run setup
bash .devcontainer/setup-demo.sh
```

### Port Already in Use

If ports 3000, 4000, or 5432 are already in use:

1. Stop conflicting services
2. Or edit `docker-compose.yml` to use different ports:
   ```yaml
   ports:
     - "3001:3000"  # Use 3001 instead of 3000
   ```

## Architecture

### Service Orchestration

Docker Compose manages four containers:

1. **demo-workspace** - VS Code development container
2. **postgres** - PostgreSQL database
3. **backend** - Semiont API server
4. **frontend** - Semiont web UI

### Networking

- **demo-workspace** uses `network_mode: service:backend` to share network with backend
- This allows localhost references to work correctly
- All services communicate via localhost

### Volume Mounts

- **postgres_data** - Persistent database storage
- **backend_data** - Backend data directory
- **workspace** - Demo repository mounted at `/workspaces/semiont-workflows`

## Comparison: Semiont Workflows Demo vs Semiont Development

This Semiont Workflows Demo container vs the [main Semiont development container](https://github.com/The-AI-Alliance/semiont):

| Aspect | Semiont Workflows Demo (this repo) | Semiont Development |
|--------|----------------------------------|---------------------|
| **Repository** | `semiont-workflows` | `semiont` |
| **Purpose** | Explore Semiont features | Build & contribute to Semiont |
| **Build Time** | ~1-2 minutes | ~5-7 minutes |
| **Source** | Published Docker images | Local source code |
| **Packages** | From npm registry | Built locally |
| **Workspace** | `/workspaces/semiont-workflows` | `/workspace` |
| **Customization** | Configuration only | Full source access |
| **Best For** | Users, demos, learning | Contributors, developers |

## About This Repository

This is the standalone Semiont Workflows Demo repository for [Semiont](https://github.com/The-AI-Alliance/semiont), showcasing its semantic annotation and knowledge extraction capabilities.

### Repository Structure

```text
semiont-workflows/
├── .devcontainer/
├── datasets/
├── docker-compose.yml
├── package.json
├── demo.ts
└── README.md
```

### Benefits

- Cleaner separation
- Independent releases
- Simpler onboarding
- Easier maintenance

## Resources

- **Main Repository**: https://github.com/The-AI-Alliance/semiont
- **Published Packages**: https://www.npmjs.com/settings/semiont/packages
- **Container Images**: https://github.com/orgs/The-AI-Alliance/packages?repo_name=semiont
- **Documentation**: https://github.com/The-AI-Alliance/semiont/tree/main/docs

## Support

For issues or questions:

- **Demo Issues**: File in main repository with `demo` label
- **Feature Requests**: Discussions tab in main repository
- **Bug Reports**: Issues tab with reproduction steps

---

**Semiont** - Your Sovereign AI Knowledge Platform
