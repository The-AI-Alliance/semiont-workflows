#!/bin/bash
# init-env.sh - Runs on HOST before containers start
# Installs Semiont CLI and packages, initializes project, patches config for devcontainer

set -euo pipefail

# Semiont version to use for all artifacts
SEMIONT_VERSION="0.2.43"

# Helper for timestamped logging
log() {
    echo "[$(date '+%H:%M:%S')] $1"
}

cd "$(dirname "$0")"

log "Starting init-env.sh (Semiont version: $SEMIONT_VERSION)"

# Create .env for docker-compose (minimal — just what compose needs)
cat > .env <<EOF
SEMIONT_VERSION=${SEMIONT_VERSION}
POSTGRES_PASSWORD=semiont
EOF
log "Created .env for docker-compose"

# Install Semiont CLI on the host (needed for semiont init below)
# Backend and frontend packages are installed by 'semiont provision' inside the container
log "Installing @semiont/cli@$SEMIONT_VERSION..."
npm cache clean --force 2>&1 | head -5 || true
npm install -g \
    "@semiont/cli@$SEMIONT_VERSION" \
    --registry https://registry.npmjs.org/ --legacy-peer-deps 2>&1 | grep -v "npm warn" || true

SEMIONT_CLI_VERSION=$(semiont --version 2>&1 | head -1 || echo "CLI command failed")
log "CLI version: $SEMIONT_CLI_VERSION"

# Initialize project directory
log "Initializing project directory..."

PROJECT_DIR="../project"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

# Run semiont init to create project structure and environments/local.json
export SEMIONT_ROOT="$(pwd)"
export SEMIONT_ENV=local

log "Running semiont init..."
semiont init --force 2>&1 || {
    log "  ✗ semiont init failed"
    exit 1
}
log "  ✓ Project initialized"

# Patch local.json for devcontainer environment:
# - Database host: localhost → postgres (Docker service name)
# - Database creds: postgres/localpass → semiont/semiont (matching docker-compose)
# - Codespaces URLs if applicable
log "Patching environments/local.json for devcontainer..."

if [ -n "${CODESPACE_NAME:-}" ]; then
    log "Detected Codespaces environment: ${CODESPACE_NAME}"
    ENVOY_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
    SITE_DOMAIN="${CODESPACE_NAME}-8080.app.github.dev"

    node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('environments/local.json', 'utf-8'));

    // Database and proxy are managed by docker-compose, not by the CLI.
    // Set them to 'external' so semiont provision/start doesn't try to create containers.
    config.services.database.platform = { type: 'external' };
    config.services.database.host = 'postgres';
    config.services.database.port = 5432;
    config.services.database.environment.POSTGRES_USER = 'semiont';
    config.services.database.environment.POSTGRES_PASSWORD = 'semiont';
    config.services.database.environment.POSTGRES_DB = 'semiont';

    if (config.services.proxy) {
      config.services.proxy.platform = { type: 'external' };
    }

    // Codespaces URLs: all public-facing URLs through Envoy
    config.site.domain = '${SITE_DOMAIN}';
    config.site.oauthAllowedDomains = ['${SITE_DOMAIN}', ...(config.site.oauthAllowedDomains || [])];
    config.services.backend.publicURL = '${ENVOY_URL}';
    config.services.backend.corsOrigin = '${ENVOY_URL}';
    config.services.frontend.publicURL = '${ENVOY_URL}';

    fs.writeFileSync('environments/local.json', JSON.stringify(config, null, 2) + '\n');
    "
    log "  ✓ Patched for Codespaces: ${ENVOY_URL}"
else
    log "Local environment detected"

    node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('environments/local.json', 'utf-8'));

    // Database and proxy are managed by docker-compose, not by the CLI.
    // Set them to 'external' so semiont provision/start doesn't try to create containers.
    config.services.database.platform = { type: 'external' };
    config.services.database.host = 'postgres';
    config.services.database.port = 5432;
    config.services.database.environment.POSTGRES_USER = 'semiont';
    config.services.database.environment.POSTGRES_PASSWORD = 'semiont';
    config.services.database.environment.POSTGRES_DB = 'semiont';

    if (config.services.proxy) {
      config.services.proxy.platform = { type: 'external' };
    }

    fs.writeFileSync('environments/local.json', JSON.stringify(config, null, 2) + '\n');
    "
    log "  ✓ Patched database and proxy config for devcontainer"
fi

cd ../.devcontainer
log "✓ init-env.sh completed successfully"
