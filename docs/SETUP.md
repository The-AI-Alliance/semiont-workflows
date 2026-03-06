# Setup Guide

Quick guide to getting started with the Semiont demo environment.

## GitHub Codespaces (Recommended)

The fastest way to get started:

1. **Launch Codespace**

   [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new/The-AI-Alliance/semiont-workflows)

2. **Wait for setup** (~2 minutes)

   The devcontainer will automatically:
   - Pull Semiont containers (backend, frontend, Envoy)
   - Start PostgreSQL database
   - Create demo admin account
   - Configure Codespaces URLs

3. **Make port 8080 public**

   - Go to the **PORTS** tab
   - Right-click port **8080** → **Port Visibility** → **Public**

4. **Open the application**

   Click the URL shown in the terminal:
   ```text
   🌐 Open the application:
      https://your-codespace-8080.app.github.dev
   ```

5. **Login**

   Use the credentials shown in the terminal:
   ```text
   👤 Demo Admin Account:
      Email:    dev-xxxxx@example.com
      Password: xxxxxxxx
   ```

## Local Development

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [VS Code](https://code.visualstudio.com/)
- [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Steps

1. **Clone the repository with submodules**

   ```bash
   git clone --recurse-submodules https://github.com/The-AI-Alliance/semiont-workflows.git
   cd semiont-workflows
   ```

   Or if you already cloned without submodules:

   ```bash
   git submodule update --init --recursive
   ```

2. **Open in VS Code**

   ```bash
   code .
   ```

3. **Reopen in Container**

   - Press `F1` or `Cmd/Ctrl+Shift+P`
   - Select: **Dev Containers: Reopen in Container**
   - Wait for setup to complete (~2-3 minutes)

4. **Open the application**

   Visit: **http://localhost:8080**

5. **Login**

   Use the credentials shown in the terminal

## What Gets Set Up

### Services Started

| Service | Port | Access | Description |
|---------|------|--------|-------------|
| Envoy | 8080 | **Public** | Single entry point for browser |
| Frontend | 3000 | Internal | Next.js UI |
| Backend | 4000 | **Public** | Hono API (also direct access) |
| Postgres | 5432 | **Public** | Database |
| Envoy Admin | 9901 | **Public** | Metrics and config |

### Files Created

- `.env` - Demo credentials and configuration
- `project/semiont.json` - Base Semiont configuration
- `project/environments/demo.json` - Demo environment config

### Demo Account

A demo admin account is automatically created with:

- **Email**: Random (e.g., `dev-a1b2c3d4@example.com`)
- **Password**: Random (shown in terminal)
- **Role**: Administrator
- **Saved to**: `.env` file

## Running the Demo

### Interactive Terminal UI

```bash
npm run demo:interactive
```

Navigate datasets with arrow keys, execute commands with Enter.

See [INTERACTIVE.md](INTERACTIVE.md) for details.

### CLI Mode

```bash
# Download and process Citizens United case
npm run demo -- citizens_united download
npm run demo -- citizens_united load
npm run demo -- citizens_united annotate
npm run demo -- citizens_united validate
```

See [WORKFLOW.md](WORKFLOW.md) for the four-phase workflow.

## Accessing Services

### Web Browser

**Primary access** (through Envoy):

- **Frontend**: http://localhost:8080
- **API docs**: http://localhost:8080/api/
- **Health check**: http://localhost:8080/api/health

### Direct API Access

For testing and scripts:

- **Backend API**: http://localhost:4000
- **Envoy admin**: http://localhost:9901
- **Database**: `postgresql://semiont:semiont@localhost:5432/semiont`

### Demo Scripts

Demo scripts use Docker service names (no Envoy):

```bash
# In .env file:
BACKEND_URL=http://backend:4000
FRONTEND_URL=http://frontend:3000
```

## Verifying Setup

### Check Services

```bash
docker compose ps
```

Expected output:
```text
NAME                                     STATUS
semiont-workflows_devcontainer-backend-1    Up (healthy)
semiont-workflows_devcontainer-envoy-1      Up
semiont-workflows_devcontainer-frontend-1   Up (healthy)
semiont-workflows_devcontainer-postgres-1   Up (healthy)
```

### Test Envoy Routing

```bash
# Should return 200
curl -I http://localhost:8080/api/health

# Should show Envoy stats
curl http://localhost:9901/stats | head -20
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f envoy
docker compose logs -f backend
docker compose logs -f frontend
```

## Troubleshooting

### Codespace won't start

**Check:**
- GitHub Actions are enabled for the repository
- You have available Codespaces hours

**Fix:**
- Try creating a new Codespace
- Check GitHub Codespaces status page

### Port 8080 not accessible

**In Codespaces:**
- Ensure port 8080 is set to **Public** (not Private)

**Locally:**
- Check if Docker Desktop is running
- Check if port 8080 is already in use: `lsof -i :8080`

### Can't login

**Check:**
- Using correct email/password from terminal output
- Check `.env` file for credentials
- Check backend logs: `docker compose logs backend`

**Fix:**
- Restart backend: `docker compose restart backend`
- Check database is healthy: `docker compose ps postgres`

### Services unhealthy

```bash
# Check status
docker compose ps

# Restart unhealthy services
docker compose restart backend frontend

# Full restart
docker compose down
docker compose up -d
```

### Setup script failed

```bash
# View setup logs
cat /tmp/setup-demo.log

# Re-run setup
bash .devcontainer/setup-demo.sh
```

## Configuration

### Environment Variables

Located in `.env` (auto-generated):

```bash
# Semiont version
SEMIONT_VERSION=0.2.27

# API URLs (Docker service names)
BACKEND_URL=http://backend:4000
FRONTEND_URL=http://frontend:3000

# Demo credentials
AUTH_EMAIL=dev-xxxxx@example.com
AUTH_PASSWORD=xxxxxxxx
```

### Semiont Configuration

Located in `project/environments/demo.json`:

- Database connection
- Backend/Frontend URLs
- Public URLs (for Envoy routing)
- CORS origins
- Allowed domains

See [ENVOY.md](ENVOY.md) for routing details.

## Next Steps

1. **Explore the demo** - Run `npm run demo:interactive`
2. **Try CLI commands** - See [WORKFLOW.md](WORKFLOW.md)
3. **Add your own dataset** - See [structured-knowledge scenarios](https://github.com/The-AI-Alliance/structured-knowledge/blob/main/scenarios/README.md)
4. **Learn the architecture** - See [ENVOY.md](ENVOY.md) and [CONTAINER.md](CONTAINER.md)

## Additional Resources

- [Interactive UI Guide](INTERACTIVE.md) - Terminal UI reference
- [Workflow Guide](WORKFLOW.md) - Four-phase processing workflow
- [Envoy Architecture](ENVOY.md) - Routing and configuration
- [Container Details](CONTAINER.md) - Devcontainer internals
- [Semiont API Client](https://github.com/The-AI-Alliance/semiont/tree/main/packages/api-client) - TypeScript SDK docs
- [Main Semiont Repository](https://github.com/The-AI-Alliance/semiont) - Development and contributing
