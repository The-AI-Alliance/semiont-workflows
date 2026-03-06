#!/bin/bash
set -euo pipefail

# Force unbuffered output
exec 2>&1
export PYTHONUNBUFFERED=1

# Fail if SEMIONT_VERSION is not set (NO DEFAULTS - FAIL LOUDLY)
if [ -z "${SEMIONT_VERSION:-}" ]; then
    echo "ERROR: SEMIONT_VERSION environment variable is not set"
    echo "This should be set by devcontainer.json containerEnv/remoteEnv"
    exit 1
fi

# Docker API version is set to 1.43 in devcontainer.json (containerEnv and remoteEnv)
# to match GitHub Codespaces Docker daemon limitations

# Detect compose project name from current environment
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename $(dirname $(pwd)))_devcontainer}"

# Generate random demo credentials for this environment
# Uses random hex string for uniqueness (not guessable)
RANDOM_ID=$(openssl rand -hex 8)
DEMO_EMAIL="dev-${RANDOM_ID}@example.com"
DEMO_PASSWORD=$(openssl rand -base64 16)

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "\n${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

clear

echo "=========================================="
echo "   SEMIONT WORKFLOWS DEMO SETUP"
echo "=========================================="
echo ""
echo "Version: $SEMIONT_VERSION"
echo ""
echo "📋 Setup Steps:"
echo "  • Install Semiont CLI globally"
echo "  • Verify project directory"
echo "  • Initialize Semiont project config"
echo "  • Configure environment URLs"
echo "  • Wait for backend service"
echo "  • Run database migrations"
echo "  • Wait for frontend service"
echo "  • Create demo admin user"
echo ""
echo "⏱️  Estimated time: 2-3 minutes"
echo "------------------------------------------"
echo ""

# Navigate to workspace root
cd /workspaces/semiont-workflows

# Install Semiont CLI globally
print_status "Installing @semiont/cli@latest globally..."
npm install -g "@semiont/cli@latest" 2>&1 | grep -v "npm warn" || true
print_success "CLI installed"

# Verify CLI installation
if command -v semiont &> /dev/null; then
    CLI_VERSION=$(semiont --version 2>&1 | head -n 1 || echo "installed")
    print_success "CLI available: $CLI_VERSION"
else
    print_warning "CLI command 'semiont' not in PATH, but package is installed"
fi

# Verify project directory exists (created by init-env.sh)
# SEMIONT_ROOT and SEMIONT_ENV are set in devcontainer.json (containerEnv and remoteEnv)
if [ -z "${SEMIONT_ROOT:-}" ]; then
    echo "ERROR: SEMIONT_ROOT environment variable is not set"
    echo "This should be set by devcontainer.json containerEnv/remoteEnv"
    exit 1
fi

if [ -z "${SEMIONT_ENV:-}" ]; then
    echo "ERROR: SEMIONT_ENV environment variable is not set"
    echo "This should be set by devcontainer.json containerEnv/remoteEnv"
    exit 1
fi

if [ ! -d "$SEMIONT_ROOT" ]; then
    print_error "Project directory not found at $SEMIONT_ROOT"
    print_error "This should have been created by init-env.sh"
    exit 1
fi

print_status "Verifying project configuration..."

# Check if already initialized by init-env.sh
if [ -f "$SEMIONT_ROOT/semiont.json" ] && [ -f "$SEMIONT_ROOT/environments/demo.json" ]; then
    print_success "Project already initialized by init-env.sh"
else
    print_status "Initializing project configuration..."

    # Initialize Semiont project
    cd $SEMIONT_ROOT || exit 1
    semiont init || {
        print_warning "semiont init failed - copying config files manually"
    }

    # Copy semiont.json if not present
    if [ ! -f "semiont.json" ]; then
        cp /workspaces/semiont-workflows/.devcontainer/semiont.json semiont.json
        print_success "semiont.json configured"
    fi

    # Copy environment config if not present
    mkdir -p environments
    if [ ! -f "environments/demo.json" ]; then
        cp /workspaces/semiont-workflows/.devcontainer/environments-demo.json environments/demo.json
        print_success "environments/demo.json configured"
    fi
fi

# Detect environment and set URLs
if [ -n "${CODESPACE_NAME:-}" ]; then
    FRONTEND_URL="https://${CODESPACE_NAME}-3000.app.github.dev"
    BACKEND_URL="https://${CODESPACE_NAME}-4000.app.github.dev"
    SITE_DOMAIN="${CODESPACE_NAME}-3000.app.github.dev"

    # Verify URLs are properly set in config
    cd $SEMIONT_ROOT || exit 1
    CURRENT_BACKEND_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('environments/demo.json', 'utf-8')).services.backend.publicURL)" 2>/dev/null || echo "")

    if [ "$CURRENT_BACKEND_URL" != "$BACKEND_URL" ]; then
        print_status "Updating Codespaces URLs in configuration..."
        node -e "
        const fs = require('fs');
        const baseConfig = JSON.parse(fs.readFileSync('semiont.json', 'utf-8'));
        const envFile = 'environments/demo.json';
        const config = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
        config.site.domain = '${SITE_DOMAIN}';
        config.site.oauthAllowedDomains = ['${SITE_DOMAIN}', ...(baseConfig.site?.oauthAllowedDomains || [])];
        config.services.frontend.url = '${FRONTEND_URL}';
        config.services.backend.publicURL = '${BACKEND_URL}';
        config.services.backend.corsOrigin = '${FRONTEND_URL}';
        fs.writeFileSync(envFile, JSON.stringify(config, null, 2));
        "
        print_success "URLs configured for Codespaces"
    else
        print_success "Codespaces URLs already configured"
    fi
else
    FRONTEND_URL="http://localhost:3000"
    BACKEND_URL="http://localhost:4000"
    print_success "Using localhost URLs"
fi

# Wait for backend service to be healthy
print_status "Waiting for backend service to start..."

MAX_WAIT=180  # Increased from 120s to account for start_period
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    # Try health check using Docker service name
    if curl -sf http://backend:4000/api/health > /dev/null 2>&1; then
        print_success "Backend is healthy"
        break
    fi

    # Show progress and diagnostic info
    if [ $((WAITED % 20)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s / ${MAX_WAIT}s)"
    fi

    sleep 2
    WAITED=$((WAITED + 2))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    print_error "Backend failed to start within ${MAX_WAIT}s"
    echo ""
    print_error "Check backend logs with: docker compose logs backend"
    print_error "(Run from a terminal with docker access)"
    exit 1
fi

# Run database migrations
# The backend container doesn't run migrations automatically on startup
# We need to run them manually via the backend container
print_status "Running database migrations..."

# Find backend container
BACKEND_CONTAINER=$(docker ps --filter "ancestor=ghcr.io/the-ai-alliance/semiont-backend:${SEMIONT_VERSION}" --format "{{.Names}}" | head -1)

if [ -z "$BACKEND_CONTAINER" ]; then
    # Fallback: try to find by name pattern
    BACKEND_CONTAINER=$(docker ps --filter "name=backend" --format "{{.Names}}" | head -1)
fi

if [ -z "$BACKEND_CONTAINER" ]; then
    print_error "Cannot find running backend container"
    print_error "Tried: ghcr.io/the-ai-alliance/semiont-backend:${SEMIONT_VERSION}"
    docker ps
    exit 1
fi

print_status "Found backend container: $BACKEND_CONTAINER"

# Run Prisma migrations
set +e
MIGRATION_RESULT=$(docker exec "$BACKEND_CONTAINER" npx prisma migrate deploy 2>&1)
MIGRATION_EXIT=$?
set -e

# Always show migration output for debugging
echo "Migration output:"
echo "$MIGRATION_RESULT"
echo ""

if [ $MIGRATION_EXIT -eq 0 ]; then
    # Check if migrations were actually applied
    if echo "$MIGRATION_RESULT" | grep -qi "No pending migrations"; then
        print_success "Database schema is up to date"
    elif echo "$MIGRATION_RESULT" | grep -qi "migration.*applied\|migration.*ran"; then
        print_success "Database migrations completed"
    else
        print_warning "Migration command succeeded but output unclear"
        print_warning "Please verify database schema manually"
    fi
else
    print_error "Migration failed with exit code $MIGRATION_EXIT:"
    echo "$MIGRATION_RESULT"
    exit 1
fi

# Wait for frontend service to be healthy
print_status "Waiting for frontend service to start..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://frontend:3000 > /dev/null 2>&1; then
        print_success "Frontend is healthy"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 10)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s)"
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    print_warning "Frontend took longer than expected to start"
    print_warning "It may still be starting - check http://frontend:3000"
fi

# Create demo admin user via direct database manipulation
#
# APPROACH: Execute SQL directly in the postgres container to create an admin user.
# This is a temporary solution until the CLI properly supports admin user creation
# without requiring @semiont/backend as a dependency.
#
# FUTURE: This will be replaced by:
#   1. Backend container having @semiont/cli installed, OR
#   2. CLI refactored to not depend on @semiont/backend for Prisma client, OR
#   3. Proper admin user creation endpoint in the backend API
#
# For now, we:
#   1. Use bcrypt (installed as devDependency) to hash the password
#   2. Execute SQL INSERT directly in postgres container
#   3. Handle duplicate user errors gracefully for idempotency
#
print_status "Creating demo admin user..."

# Find postgres container
POSTGRES_CONTAINER=$(docker ps --filter "ancestor=postgres:16-alpine" --format "{{.Names}}" | head -1)

if [ -z "$POSTGRES_CONTAINER" ]; then
    # Fallback: try to find by name pattern
    POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1)
fi

if [ -z "$POSTGRES_CONTAINER" ]; then
    print_error "Cannot find running postgres container"
    print_error "Tried: postgres:16-alpine"
    docker ps
    exit 1
fi

print_status "Found postgres container: $POSTGRES_CONTAINER"

# Hash password using bcrypt (same as backend: 12 rounds)
# bcrypt is installed as a devDependency via npm install in postCreateCommand
print_status "Hashing password with bcrypt..."
HASHED_PASSWORD=$(node -e "
const bcrypt = require('bcrypt');
const hash = bcrypt.hashSync('$DEMO_PASSWORD', 12);
console.log(hash);
")

if [ -z "$HASHED_PASSWORD" ]; then
    print_error "Failed to hash password"
    exit 1
fi

# Generate timestamps
CREATED_AT=$(date -u +"%Y-%m-%d %H:%M:%S")
UPDATED_AT="$CREATED_AT"

# Create admin user in database
print_status "Inserting admin user into database..."

# Extract domain from email for domain-based access control
DEMO_DOMAIN=$(echo "$DEMO_EMAIL" | cut -d'@' -f2)

# Generate a CUID-compatible ID for the user (must start with 'c' and be 25+ chars)
# Format: c + 24 lowercase alphanumeric characters
DEMO_USER_ID="c$(openssl rand -hex 12 | tr 'A-F' 'a-f')"

# Use ON CONFLICT to make this idempotent
# Disable pipefail temporarily to capture error output
set +e

# Build SQL command on a single line to avoid escaping issues with multiline strings
# Use printf to properly escape the bcrypt hash which contains $ characters
# Table name is "users" (lowercase), columns: id, email, passwordHash, name, provider, providerId, domain, isAdmin, isActive, createdAt, updatedAt
SQL_RESULT=$(docker exec "$POSTGRES_CONTAINER" psql -U semiont -d semiont -t -c \
"INSERT INTO users (id, email, \"passwordHash\", name, provider, \"providerId\", domain, \"isAdmin\", \"isActive\", \"createdAt\", \"updatedAt\") VALUES ('$DEMO_USER_ID', '$DEMO_EMAIL', E'$(printf '%s' "$HASHED_PASSWORD" | sed "s/'/''/g")', 'Demo Admin', 'password', '$DEMO_EMAIL', '$DEMO_DOMAIN', true, true, '$CREATED_AT', '$UPDATED_AT') ON CONFLICT (email) DO NOTHING RETURNING email;" 2>&1)
SQL_EXIT_CODE=$?
set -e

# Debug: show what we got back
echo "SQL_EXIT_CODE: $SQL_EXIT_CODE" >&2
echo "SQL_RESULT: '$SQL_RESULT'" >&2

if [ $SQL_EXIT_CODE -ne 0 ]; then
    print_error "SQL command failed with exit code $SQL_EXIT_CODE:"
    echo "$SQL_RESULT"
    exit 1
fi

if echo "$SQL_RESULT" | grep -q "$DEMO_EMAIL"; then
    print_success "Demo admin user created: $DEMO_EMAIL"
elif echo "$SQL_RESULT" | grep -qi "ERROR"; then
    print_error "Database error:"
    echo "$SQL_RESULT"
    exit 1
else
    print_warning "User already exists (this is fine)"
    print_success "Using existing demo admin user: $DEMO_EMAIL"
fi

# Update URLs for Codespaces if running in GitHub Codespaces
if [ -n "${CODESPACE_NAME:-}" ]; then
    print_status "Detected GitHub Codespaces environment, updating URLs..."

    # GitHub Codespaces URL format: https://$CODESPACE_NAME-$PORT.app.github.dev
    FRONTEND_URL="https://${CODESPACE_NAME}-3000.app.github.dev"
    ENVOY_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
    SITE_DOMAIN="${CODESPACE_NAME}-8080.app.github.dev"

    # Update environment config with Codespaces URLs using Node.js
    cd /workspaces/semiont-workflows
    node -e "
    const fs = require('fs');
    const envFile = 'project/environments/demo.json';
    const config = JSON.parse(fs.readFileSync(envFile, 'utf-8'));

    config.site.domain = '${SITE_DOMAIN}';
    config.services.frontend.url = '${FRONTEND_URL}';
    config.services.frontend.publicURL = '${ENVOY_URL}';
    config.services.frontend.allowedOrigins = [
      '${SITE_DOMAIN}',
      '${CODESPACE_NAME}-3000.app.github.dev'
    ];
    config.services.backend.publicURL = '${ENVOY_URL}';
    config.services.backend.corsOrigin = '${ENVOY_URL}';

    fs.writeFileSync(envFile, JSON.stringify(config, null, 2));
    "

    print_success "URLs configured for Codespaces: ${ENVOY_URL}"
else
    print_success "Environment configuration set for localhost"
fi

# Save demo .env credentials
print_status "Saving demo configuration..."
cd /workspaces/semiont-workflows

# For demo scripts running inside the devcontainer, use Docker Compose service names
# All services are on the same Docker network and can access each other by service name
# The public Codespaces URLs are for browser access only
DEMO_BACKEND_URL="http://backend:4000"
DEMO_FRONTEND_URL="http://frontend:3000"

echo ""
echo "Generated credentials:"
echo "  Email:    ${DEMO_EMAIL}"
echo "  Password: ${DEMO_PASSWORD}"
echo ""

cat > .env <<EOF
# Semiont Demo Environment
SEMIONT_VERSION=${SEMIONT_VERSION}
SEMIONT_ENV=demo
SEMIONT_ROOT=${SEMIONT_ROOT}

# API URLs (using Docker service names for internal access)
BACKEND_URL=${DEMO_BACKEND_URL}
FRONTEND_URL=${DEMO_FRONTEND_URL}

# Demo Account Credentials
AUTH_EMAIL=${DEMO_EMAIL}
AUTH_PASSWORD=${DEMO_PASSWORD}
EOF
print_success "Demo configuration saved to .env"

# Verify actual running container versions
print_status "Verifying running container versions..."
echo ""
ACTUAL_BACKEND_IMAGE=$(docker inspect "$BACKEND_CONTAINER" --format='{{.Config.Image}}')
ACTUAL_FRONTEND_IMAGE=$(docker ps --filter 'name=frontend' --format '{{.Image}}' | head -1)
ACTUAL_POSTGRES_IMAGE=$(docker inspect "$POSTGRES_CONTAINER" --format='{{.Config.Image}}')

echo "Backend image:  $ACTUAL_BACKEND_IMAGE"
echo "Frontend image: $ACTUAL_FRONTEND_IMAGE"
echo "Postgres image: $ACTUAL_POSTGRES_IMAGE"
echo ""

# Check for version mismatches
EXPECTED_BACKEND_IMAGE="ghcr.io/the-ai-alliance/semiont-backend:${SEMIONT_VERSION}"
EXPECTED_FRONTEND_IMAGE="ghcr.io/the-ai-alliance/semiont-frontend:${SEMIONT_VERSION}"

if [ "$ACTUAL_BACKEND_IMAGE" != "$EXPECTED_BACKEND_IMAGE" ] || [ "$ACTUAL_FRONTEND_IMAGE" != "$EXPECTED_FRONTEND_IMAGE" ]; then
    print_error "VERSION MISMATCH DETECTED!"
    echo ""
    echo "Expected backend:  $EXPECTED_BACKEND_IMAGE"
    echo "Actual backend:    $ACTUAL_BACKEND_IMAGE"
    echo ""
    echo "Expected frontend: $EXPECTED_FRONTEND_IMAGE"
    echo "Actual frontend:   $ACTUAL_FRONTEND_IMAGE"
    echo ""
    print_error "Containers are running the wrong version."
    print_error "This codespace needs to be rebuilt to use version ${SEMIONT_VERSION}."
    echo ""
    echo "To fix this:"
    echo "  1. In VS Code: Command Palette > 'Codespaces: Rebuild Container'"
    echo "  2. Or from terminal: Exit this codespace and create a new one"
    echo ""
    print_error "Setup cannot continue with mismatched versions."
    exit 1
fi

print_success "All containers are running the correct version: ${SEMIONT_VERSION}"

echo ""
echo "=========================================="
echo "   ✅ SEMIONT WORKFLOWS DEMO READY!"
echo "=========================================="
echo ""

# Show appropriate URLs based on environment
if [ -n "${CODESPACE_NAME:-}" ]; then
    ENVOY_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
    echo "⚠️  IMPORTANT: Make port 8080 public (Envoy proxy - main entry point):"
    echo "   • Go to the PORTS tab"
    echo "   • Right-click port 8080 → Port Visibility → Public"
    echo ""
    echo "🌐 Open the application:"
    echo "   ${ENVOY_URL}"
    echo ""
    echo "📊 Database:  postgresql://semiont:semiont@postgres:5432/semiont"
    echo "📁 Project:   $SEMIONT_ROOT"
else
    echo "🌐 Open the application:"
    echo "   http://localhost:8080 (Envoy proxy - recommended)"
    echo ""
    echo "📊 Database:  postgresql://semiont:semiont@postgres:5432/semiont"
    echo "📁 Project:   $SEMIONT_ROOT"
fi

echo ""
echo "👤 Demo Admin Account:"
echo "   Email:    $DEMO_EMAIL"
echo "   Password: $DEMO_PASSWORD"
echo "   Role:     Administrator"
echo ""
echo "💾 Credentials saved to: /workspaces/semiont-workflows/.env"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 NEXT STEP: Run the Interactive Demo"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "    npm run demo:interactive"
echo ""
echo "This will guide you through creating and managing"
echo "agents with the Semiont framework."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📖 Documentation:"
echo "   • Demo guide:      cat README.md"
echo "   • Container info:  cat docs/CONTAINER.md"
echo "   • Workflow guide:  cat docs/WORKFLOW.md"
echo "   • Interactive UI:  cat docs/INTERACTIVE.md"
echo ""
echo "🔧 Useful Commands:"
echo "   • Check services:  docker compose ps"
echo "   • View logs:       docker compose logs -f"
echo "   • Restart Envoy:   docker compose restart envoy"
echo "   • Restart backend: docker compose restart backend"
echo "   • CLI commands:    semiont --help"
echo ""
