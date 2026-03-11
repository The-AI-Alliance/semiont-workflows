#!/bin/bash
# setup-demo.sh - Provision, start services, and create demo admin user
# Uses the Semiont CLI

set -euo pipefail

# Fail if required environment variables are not set (NO DEFAULTS)
if [ -z "${SEMIONT_VERSION:-}" ]; then
    echo "ERROR: SEMIONT_VERSION environment variable is not set"
    exit 1
fi
if [ -z "${SEMIONT_ROOT:-}" ]; then
    echo "ERROR: SEMIONT_ROOT environment variable is not set"
    exit 1
fi
if [ -z "${SEMIONT_ENV:-}" ]; then
    echo "ERROR: SEMIONT_ENV environment variable is not set"
    exit 1
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "\n${BLUE}▶${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1" >&2; }

clear

echo "=========================================="
echo "   SEMIONT WORKFLOWS DEMO SETUP"
echo "=========================================="
echo ""
echo "Version:     $SEMIONT_VERSION"
echo "Environment: $SEMIONT_ENV"
echo "Root:        $SEMIONT_ROOT"
echo ""

# Install Semiont CLI inside the container
# (init-env.sh installs on the host for semiont init, but postCreateCommand runs inside the container)
# Backend and frontend packages are installed by 'semiont provision'
print_status "Installing Semiont CLI in container..."
npm install -g \
    "@semiont/cli@$SEMIONT_VERSION" \
    --registry https://registry.npmjs.org/ --legacy-peer-deps 2>&1 | tail -3
print_success "Semiont CLI $(semiont --version 2>&1 | head -1)"

# Generate random demo credentials
RANDOM_ID=$(openssl rand -hex 8)
DEMO_EMAIL="dev-${RANDOM_ID}@example.com"

# Wait for postgres to be ready (using Node.js TCP check — no postgresql-client needed)
print_status "Waiting for PostgreSQL at postgres:5432..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if node -e "const net = require('net'); const s = net.connect(5432, 'postgres', () => { s.end(); process.exit(0); }); s.on('error', () => process.exit(1)); setTimeout(() => process.exit(1), 3000);" 2>/dev/null; then
        print_success "PostgreSQL is ready"
        break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
    if [ $((WAITED % 15)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s)"
        # Show DNS resolution status for debugging
        node -e "require('dns').lookup('postgres', (err, addr) => console.log(err ? '  DNS: ' + err.message : '  DNS: postgres -> ' + addr));" 2>/dev/null || true
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    print_error "PostgreSQL failed to start within ${MAX_WAIT}s"
    echo "  Debug: attempting DNS lookup for 'postgres'..."
    node -e "require('dns').lookup('postgres', (err, addr) => console.log(err ? 'DNS failed: ' + err.message : 'DNS resolves to: ' + addr));" 2>/dev/null || true
    exit 1
fi

# Provision services (generates .env files, runs migrations, sets up proxy)
print_status "Provisioning services..."
semiont provision -e "$SEMIONT_ENV" --verbose || {
    print_error "Provisioning failed"
    exit 1
}
print_success "Services provisioned"

# Start backend and frontend
print_status "Starting services..."
semiont start -e "$SEMIONT_ENV" --verbose || {
    print_error "Failed to start services"
    exit 1
}
print_success "Services started"

# Wait for backend to be healthy
print_status "Waiting for backend to be healthy..."
MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://127.0.0.1:4000/health > /dev/null 2>&1; then
        print_success "Backend is healthy"
        break
    fi
    sleep 3
    WAITED=$((WAITED + 3))
    if [ $((WAITED % 15)) -eq 0 ]; then
        echo "  Still waiting... (${WAITED}s)"
        # Show backend log tail for debugging
        tail -3 /workspaces/semiont-workflows/project/backend/logs/app.log 2>/dev/null || true
    fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
    print_error "Backend failed to become healthy within ${MAX_WAIT}s"
    echo "  Backend logs:"
    tail -20 /workspaces/semiont-workflows/project/backend/logs/app.log 2>/dev/null || echo "  (no log file found)"
    tail -20 /workspaces/semiont-workflows/project/backend/logs/error.log 2>/dev/null || true
    exit 1
fi

# Create demo admin user
print_status "Creating demo admin user..."
USERADD_OUTPUT=$(semiont useradd --email "$DEMO_EMAIL" --generate-password --admin 2>&1)
echo "$USERADD_OUTPUT"

# Extract the generated password from the output
DEMO_PASSWORD=$(echo "$USERADD_OUTPUT" | sed -n 's/.*[Pp]assword:[[:space:]]*//p' | head -1)

if [ -z "$DEMO_PASSWORD" ]; then
    print_warning "Could not extract password from output — check above for credentials"
fi

print_success "Demo admin user created: $DEMO_EMAIL"

# Save demo .env credentials
print_status "Saving demo configuration..."
cd /workspaces/semiont-workflows

# Determine the public URL
if [ -n "${CODESPACE_NAME:-}" ]; then
    SEMIONT_URL="https://${CODESPACE_NAME}-8080.app.github.dev"
else
    SEMIONT_URL="http://localhost:8080"
fi

cat > .env <<EOF
# Semiont Demo Environment
SEMIONT_URL=${SEMIONT_URL}

# Demo Account Credentials
AUTH_EMAIL=${DEMO_EMAIL}
AUTH_PASSWORD=${DEMO_PASSWORD}

# Data directory for staging downloads before upload to Semiont
DATA_DIR=data
EOF
print_success "Demo configuration saved to .env"

echo ""
echo "=========================================="
echo "   ✅ SEMIONT WORKFLOWS DEMO READY!"
echo "=========================================="
echo ""

if [ -n "${CODESPACE_NAME:-}" ]; then
    echo "⚠️  IMPORTANT: Make port 8080 public:"
    echo "   • Go to the PORTS tab"
    echo "   • Right-click port 8080 → Port Visibility → Public"
    echo ""
    echo "🌐 Open the application:"
    echo "   ${SEMIONT_URL}"
else
    echo "🌐 Open the application:"
    echo "   http://localhost:8080"
fi

echo ""
echo "👤 Demo Admin Account:"
echo "   Email:    $DEMO_EMAIL"
if [ -n "$DEMO_PASSWORD" ]; then
    echo "   Password: $DEMO_PASSWORD"
fi
echo ""
echo "💾 Credentials saved to: /workspaces/semiont-workflows/.env"
echo ""
echo "🎯 Next step: npm run demo:interactive"
echo ""
