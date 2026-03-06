# Envoy Proxy Architecture

The Semiont demo uses [Envoy](https://www.envoyproxy.io/) as a reverse proxy to route all browser traffic through a single entry point on port 8080.

## Why Envoy?

**Problems without Envoy:**

1. OAuth redirects break (NextAuth redirects to `:3000` instead of staying on consistent URL)
2. Frontend server-side auth calls fail (can't reach `localhost:4000` from container)
3. Backend generates resource URIs with `:4000` that violate Content Security Policy
4. CORS configuration complexity (multiple origins)
5. Inconsistent public URLs in different contexts

**Benefits with Envoy:**

- Single public entry point (port 8080)
- OAuth authentication works correctly
- No CSP violations
- Simplified CORS (single origin)
- Production-like architecture (mirrors AWS ALB)
- Works in both local and GitHub Codespaces environments

## Port Strategy

| Port | Service | Access | Purpose |
|------|---------|--------|---------|
| 8080 | Envoy | **PUBLIC** | Single entry point for all browser traffic |
| 3000 | Frontend | Internal only | Container-to-container communication |
| 4000 | Backend | **PUBLIC** | Direct API access for scripts and debugging |
| 5432 | Postgres | **PUBLIC** | Database access |
| 9901 | Envoy Admin | **PUBLIC** | Envoy metrics and administration |

## Routing Rules

Envoy routes traffic based on URL path prefixes. **Order matters** - first match wins.

| Path Pattern | Target | Purpose |
|--------------|--------|---------|
| `/api/auth*` | Frontend | NextAuth authentication |
| `/api/cookies*` | Frontend | Cookie consent/export |
| `/api/resources*` | Frontend | Authenticated image/file proxy |
| `/resources*` | Backend | Main API - resources |
| `/annotations*` | Backend | Main API - annotations |
| `/admin*` | Backend | Admin API |
| `/entity-types*` | Backend | Entity types API |
| `/jobs*` | Backend | Jobs API |
| `/users*` | Backend | Users API |
| `/tokens*` | Backend | Token generation API |
| `/health*` | Backend | Health checks |
| `/status*` | Backend | Status endpoint |
| `/api/*` | Backend | OpenAPI docs and spec |
| `/*` | Frontend | Next.js pages (catch-all) |

## Traffic Patterns

### Browser → Application

```text
Browser
  ↓
http://localhost:8080
  ↓
Envoy (routes by path)
  ↓                ↓
Frontend:3000   Backend:4000
```

**Example:**

- `http://localhost:8080/` → Frontend (Next.js homepage)
- `http://localhost:8080/api/auth/signin` → Frontend (NextAuth)
- `http://localhost:8080/resources` → Backend (API)
- `http://localhost:8080/api/` → Backend (OpenAPI docs)

### Demo Scripts → Backend

Demo scripts bypass Envoy and connect directly to the backend using Docker service names:

```text
demo.ts
  ↓
http://backend:4000
  ↓
Backend:4000
```

This direct access is faster and doesn't require routing through Envoy.

### Frontend Server-Side → Backend

Server-side code in the frontend (NextAuth, Server Actions) also bypasses Envoy:

```text
Frontend container
  ↓
http://backend:4000
  ↓
Backend:4000
```

**Environment variable:** `SERVER_API_URL=http://backend:4000`

## Configuration

### Envoy Configuration

Location: [.devcontainer/envoy.yaml](../.devcontainer/envoy.yaml)

The configuration defines:

- Listener on port 8080
- Route matching rules (order matters!)
- Cluster definitions for frontend and backend
- Admin interface on port 9901

**Key differences from main Semiont repo:**

- Cluster addresses use Docker service names (`frontend:3000`, `backend:4000`) instead of `127.0.0.1`
- This is because Envoy runs in its own container, not on the host

### Environment Configuration

Location: [project/environments/demo.json](../project/environments/demo.json)

```json
{
  "site": {
    "domain": "localhost:8080"
  },
  "services": {
    "backend": {
      "publicURL": "http://localhost:8080",
      "corsOrigin": "http://localhost:8080"
    },
    "frontend": {
      "url": "http://localhost:3000",
      "publicURL": "http://localhost:8080",
      "allowedOrigins": ["localhost:3000", "localhost:8080"]
    }
  }
}
```

**Key fields:**

- `publicURL`: URL used to generate resource links (must be Envoy URL for browser access)
- `corsOrigin`: Where backend accepts requests from (Envoy URL)
- `allowedOrigins`: Next.js Server Actions allowed origins

### Docker Compose

Location: [.devcontainer/docker-compose.yml](../.devcontainer/docker-compose.yml)

```yaml
envoy:
  image: envoyproxy/envoy:v1.28-latest
  volumes:
    - ./envoy.yaml:/etc/envoy/envoy.yaml:ro
  ports:
    - "8080:8080"  # Public entry point
    - "9901:9901"  # Admin interface
  depends_on:
    frontend:
      condition: service_started
    backend:
      condition: service_started

frontend:
  environment:
    NEXTAUTH_URL: http://localhost:8080  # Envoy, not direct frontend
    SERVER_API_URL: http://backend:4000  # Docker service name

backend:
  ports:
    - "4000:4000"  # Direct API access (optional)
```

## GitHub Codespaces

In Codespaces, the setup script automatically updates URLs:

```bash
# Detected: CODESPACE_NAME=studious-sniffle-694rq9gv
# Configures:
ENVOY_URL="https://studious-sniffle-694rq9gv-8080.app.github.dev"
```

**Important:** Make port 8080 public in Codespaces (Ports tab → right-click → Public)

## Debugging

### Check Envoy Status

```bash
# View Envoy admin interface
curl http://localhost:9901/stats

# Check cluster health
curl http://localhost:9901/clusters

# View configuration
curl http://localhost:9901/config_dump
```

### Test Routing

```bash
# Should route to backend
curl -I http://localhost:8080/api/health

# Should route to frontend
curl -I http://localhost:8080/

# Direct backend access (bypass Envoy)
curl -I http://localhost:4000/api/health
```

### View Logs

```bash
# Envoy logs
docker logs semiont-workflows_devcontainer-envoy-1

# All services
docker compose logs -f
```

## Troubleshooting

### OAuth redirect loops

**Symptom:** After login, browser redirects to `:3000` instead of `:8080`

**Cause:** `NEXTAUTH_URL` pointing to frontend direct instead of Envoy

**Fix:** Ensure `NEXTAUTH_URL=http://localhost:8080` in docker-compose.yml

### CSP violations

**Symptom:** Browser console shows "Content Security Policy" errors with `:4000` URLs

**Cause:** Backend `publicURL` pointing to port 4000 instead of 8080

**Fix:** Ensure `backend.publicURL: "http://localhost:8080"` in environment config

### 404 errors on API routes

**Symptom:** `/resources` or `/annotations` return 404

**Cause:** Envoy routing rules misconfigured or path has trailing slash

**Fix:**
- Check [.devcontainer/envoy.yaml](../.devcontainer/envoy.yaml) routing rules
- Ensure no trailing slashes in route prefixes

### Frontend can't reach backend

**Symptom:** Frontend logs show `ECONNREFUSED` connecting to backend

**Cause:** `SERVER_API_URL` using wrong URL

**Fix:** Ensure `SERVER_API_URL=http://backend:4000` (Docker service name, not localhost)

## Related Documentation

- [SETUP.md](SETUP.md) - Getting started guide
- [CONTAINER.md](CONTAINER.md) - Container architecture details
- [Envoy Documentation](https://www.envoyproxy.io/docs/envoy/latest/) - Official Envoy docs
- [ENVOY-MIGRATION.md](../ENVOY-MIGRATION.md) - Lessons learned from main Semiont repo
