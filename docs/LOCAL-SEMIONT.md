# Local Semiont (npm-only)

Run Semiont locally using the published npm packages -- no need to clone the Semiont repository.

## Prerequisites

- **Node.js** v20 or higher
- **Docker or Podman** (for PostgreSQL container)

## Setup

### 1. Install the CLI

```bash
npm install -g @semiont/cli
```

### 2. Create a Project Directory

```bash
mkdir my_semiont_project
cd my_semiont_project
```

### 3. Set Environment Variables

```bash
export SEMIONT_ROOT=$(pwd)
export SEMIONT_ENV=local
```

`SEMIONT_ROOT` tells the CLI where your project lives, so you can run commands from any directory.

### 4. Initialize the Project

```bash
semiont init
```

This creates `semiont.json` and `environments/local.json`.

### 5. Review the Configuration

```bash
cat environments/local.json
```

Edit this file to set database credentials, API keys, or adjust ports.

### 6. Provision Services

```bash
semiont provision
```

Generates `.env` files for backend and frontend, processes proxy configuration, and pushes the database schema.

### 7. Start Services

```bash
semiont start
```

Starts the database container, backend, frontend, and proxy.

### 8. Verify

```bash
semiont check
```

### 9. Create an Admin User

```bash
semiont useradd --email you@example.com --generate-password --admin
```

Note the generated password from the output.

### 10. Access the Application

Open http://localhost:8080 and log in with the admin credentials from step 9.

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Envoy Proxy | 8080 | http://localhost:8080 (main entry point) |
| Frontend | 3000 | http://localhost:3000 (direct) |
| Backend | 4000 | http://localhost:4000 (direct) |
| PostgreSQL | 5432 | postgresql://localhost:5432 |

## Common Tasks

### Start/Stop Individual Services

```bash
semiont start --service backend
semiont stop --service backend
semiont check
```

### Re-provision After Config Changes

```bash
semiont provision --service frontend
semiont provision --service backend
```

## Key Difference from Upstream

The [upstream LOCAL-DEVELOPMENT.md](https://github.com/The-AI-Alliance/semiont/blob/main/docs/LOCAL-DEVELOPMENT.md) requires cloning the Semiont repository, building it, and setting `SEMIONT_REPO`. This guide skips all of that -- you only need `@semiont/cli` from npm. The CLI pulls pre-built container images from the GitHub Container Registry.

If you need to modify Semiont itself (backend, frontend, or CLI source), use the upstream guide instead.
