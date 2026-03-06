# Secrets and Configuration Management

This document explains how secrets and sensitive configuration are handled in the semiont-workflows demo repository and how to configure them for production deployments.

---

## Table of Contents

- [Demo vs. Production](#demo-vs-production)
- [Authentication Secrets](#authentication-secrets)
- [Database Credentials](#database-credentials)
- [AI Service Keys](#ai-service-keys)
- [OAuth Providers](#oauth-providers)
- [Production Deployment Guide](#production-deployment-guide)
- [GitHub Codespaces Secrets](#github-codespaces-secrets)

---

## Demo vs. Production

**Demo Configuration (Current):**
- Hardcoded default secrets for quick setup
- All secrets shared across Codespaces
- Suitable for development and demonstrations only
- **NOT secure for production use**

**Production Requirements:**
- Unique, randomly-generated secrets per environment
- Secrets stored in secure secret management systems
- Environment variables injected at runtime
- Regular secret rotation

---

## Authentication Secrets

### JWT_SECRET

**Purpose:** Signs JWT tokens issued by the backend API for user authentication.

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (backend service)
JWT_SECRET: ${JWT_SECRET:-demo-jwt-secret-minimum-32-characters-long}
```

**How It Works:**
- Reads from environment variable `JWT_SECRET`
- Falls back to hardcoded default: `demo-jwt-secret-minimum-32-characters-long`
- Used by backend to sign and verify JWT authentication tokens
- Minimum 32 characters required

**Production Recommendations:**
```bash
# Generate a strong random secret
JWT_SECRET=$(openssl rand -base64 48)

# Store in secure secret manager (AWS Secrets Manager, HashiCorp Vault, etc.)
# Inject at runtime via environment variables
```

**Security Impact:**
- ⚠️ If compromised, attackers can forge authentication tokens
- ⚠️ Changing this secret invalidates all existing user sessions
- ⚠️ Must be kept confidential and rotated periodically

---

### NEXTAUTH_SECRET

**Purpose:** Used by NextAuth.js to encrypt session cookies, sign CSRF tokens, and secure OAuth flows.

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (frontend service)
NEXTAUTH_URL: ${NEXTAUTH_URL}
NEXTAUTH_SECRET: ${NEXTAUTH_SECRET:-demo-nextauth-secret-minimum-32-characters-long}
```

**How It Works:**
- Reads from environment variable `NEXTAUTH_SECRET`
- Falls back to hardcoded default: `demo-nextauth-secret-minimum-32-characters-long`
- Used by NextAuth.js for:
  - Session cookie encryption
  - CSRF token generation
  - OAuth state parameter signing
  - JWT session signing (if using JWT strategy)
- Minimum 32 characters required

**Production Recommendations:**
```bash
# Generate a strong random secret (different from JWT_SECRET)
NEXTAUTH_SECRET=$(openssl rand -base64 48)

# Store separately from JWT_SECRET in secret manager
```

**Security Impact:**
- ⚠️ If compromised, attackers can decrypt session cookies
- ⚠️ If compromised, CSRF protection is bypassed
- ⚠️ Changing this secret logs out all users
- ⚠️ Must be different from JWT_SECRET

---

### ENABLE_LOCAL_AUTH

**Purpose:** Controls whether email/password (credentials-based) authentication is enabled.

**Current Configuration:**
- **NOT SET** in this repository
- Should be explicitly configured based on authentication strategy

**Recommended Configuration:**

For demo/development:
```yaml
# Backend
ENABLE_LOCAL_AUTH: true

# Frontend
NEXT_PUBLIC_ENABLE_LOCAL_AUTH: true
```

For production:
```yaml
# Enable if you want users to create accounts with email/password
ENABLE_LOCAL_AUTH: true
NEXT_PUBLIC_ENABLE_LOCAL_AUTH: true

# Disable if you only want OAuth/SSO authentication
ENABLE_LOCAL_AUTH: false
NEXT_PUBLIC_ENABLE_LOCAL_AUTH: false
```

**Security Considerations:**
- Password authentication requires secure password hashing (bcrypt)
- Increases attack surface (credential stuffing, password spraying)
- Consider enforcing MFA when enabled
- OAuth-only deployments have simpler security models

**Note:** See [PASSWORD-AUTH-VARIABLE.md](../PASSWORD-AUTH-VARIABLE.md) for a recommendation to rename this variable.

---

## Database Credentials

### PostgreSQL

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (postgres service)
POSTGRES_DB: semiont
POSTGRES_USER: semiont
POSTGRES_PASSWORD: semiont

# Backend connection string
DATABASE_URL: postgresql://semiont:semiont@postgres:5432/semiont
```

**How It Works:**
- Hardcoded credentials for demo database
- Database accessible only within Docker network
- Backend connects using service name `postgres`

**Production Recommendations:**

**Option 1: Managed Database Service**
```bash
# AWS RDS, Google Cloud SQL, Azure Database, etc.
DATABASE_URL=postgresql://user:password@prod-db.region.rds.amazonaws.com:5432/semiont

# Credentials injected from secret manager
# Use IAM authentication when possible (AWS RDS, Cloud SQL)
```

**Option 2: Self-Hosted with Strong Credentials**
```bash
# Generate strong password
DB_PASSWORD=$(openssl rand -base64 32)

DATABASE_URL=postgresql://semiont:${DB_PASSWORD}@database-host:5432/semiont
```

**Security Best Practices:**
- Use unique credentials per environment
- Enable SSL/TLS for database connections
- Restrict database network access (VPC, security groups)
- Use read-only credentials for read-only operations
- Regular automated backups
- Enable database audit logging

---

## AI Service Keys

### Anthropic API Key

**Purpose:** Authenticates requests to Anthropic's Claude API for AI-powered features.

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (backend service)
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}

# project/environments/demo.json
"inference": {
  "type": "anthropic",
  "apiKey": "${ANTHROPIC_API_KEY}"
}
```

**How It Works:**
- Optional: Demo works without AI features
- Reads from environment variable
- If not set, AI-powered features are disabled
- Backend makes API calls to `https://api.anthropic.com`

**Production Recommendations:**
```bash
# Store in secret manager
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Monitor usage and set rate limits
# Implement request queuing and retries
# Cache responses when appropriate
```

**Security Best Practices:**
- Never commit API keys to version control
- Use environment-specific keys (dev, staging, prod)
- Monitor API usage for anomalies
- Rotate keys periodically
- Set up billing alerts

---

### Neo4j Credentials

**Purpose:** Connects to Neo4j graph database for knowledge graph features.

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (backend service)
NEO4J_URI: ${NEO4J_URI:-}
NEO4J_USERNAME: ${NEO4J_USERNAME:-}
NEO4J_PASSWORD: ${NEO4J_PASSWORD:-}
NEO4J_DATABASE: ${NEO4J_DATABASE:-}

# project/environments/demo.json
"graph": {
  "type": "neo4j",
  "uri": "${NEO4J_URI}",
  "username": "${NEO4J_USERNAME}",
  "password": "${NEO4J_PASSWORD}",
  "database": "${NEO4J_DATABASE}"
}
```

**How It Works:**
- Optional: Demo works without graph features
- Supports Neo4j Aura (cloud) or self-hosted
- Uses bolt:// or neo4j+s:// protocol

**Production Recommendations:**

**Neo4j Aura (Recommended):**
```bash
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=$(openssl rand -base64 32)
NEO4J_DATABASE=neo4j
```

**Self-Hosted:**
```bash
NEO4J_URI=bolt://neo4j-host:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=$(openssl rand -base64 32)
NEO4J_DATABASE=semiont
```

**Security Best Practices:**
- Use encrypted connections (neo4j+s://)
- Create application-specific users with minimal privileges
- Enable authentication and role-based access control
- Regular backups of graph data
- Monitor query performance and patterns

---

## OAuth Providers

### Google OAuth

**Purpose:** Enables "Sign in with Google" functionality.

**Current Configuration:**
```yaml
# .devcontainer/docker-compose.yml (frontend service)
GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
```

**How It Works:**
- Optional: Only needed if enabling Google OAuth
- Requires OAuth app configured in Google Cloud Console
- Callback URL must match `${NEXTAUTH_URL}/api/auth/callback/google`

**Setup Steps:**

1. **Create OAuth App** in [Google Cloud Console](https://console.cloud.google.com)
   - Create new project
   - Enable Google+ API
   - Create OAuth 2.0 Client ID
   - Application type: Web application

2. **Configure Authorized Redirect URIs:**
   ```
   http://localhost:8080/api/auth/callback/google (development)
   https://your-domain.com/api/auth/callback/google (production)
   ```

3. **Set Environment Variables:**
   ```bash
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   ```

**Production Recommendations:**
- Use separate OAuth apps for dev/staging/prod
- Store client secrets in secret manager
- Configure authorized domains in Google Console
- Enable only necessary OAuth scopes (email, profile)
- Monitor OAuth usage and anomalies

**Security Best Practices:**
- Never commit client secrets to version control
- Validate email domains if using workspace accounts
- Implement account linking carefully
- Consider workspace-only access for enterprise

### Other OAuth Providers

NextAuth.js supports additional providers that can be configured:

**GitHub:**
```yaml
GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID:-}
GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET:-}
```

**Microsoft/Azure AD:**
```yaml
AZURE_AD_CLIENT_ID: ${AZURE_AD_CLIENT_ID:-}
AZURE_AD_CLIENT_SECRET: ${AZURE_AD_CLIENT_SECRET:-}
AZURE_AD_TENANT_ID: ${AZURE_AD_TENANT_ID:-}
```

See [NextAuth.js Providers](https://next-auth.js.org/providers/) for full list.

---

## Production Deployment Guide

### Secret Management Strategy

**1. Use a Secret Manager**

AWS Secrets Manager example:
```bash
# Store secrets
aws secretsmanager create-secret \
  --name prod/semiont/jwt-secret \
  --secret-string $(openssl rand -base64 48)

# Retrieve at runtime
JWT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id prod/semiont/jwt-secret \
  --query SecretString \
  --output text)
```

**2. Inject Secrets at Runtime**

Do NOT build secrets into Docker images:
```yaml
# Good: Environment variables injected at runtime
services:
  backend:
    image: ghcr.io/the-ai-alliance/semiont-backend:latest
    environment:
      JWT_SECRET: ${JWT_SECRET}  # Injected from secure source

# Bad: Secrets in image
services:
  backend:
    build:
      args:
        JWT_SECRET: hardcoded-secret  # Never do this!
```

**3. Use Environment-Specific Secrets**

```
dev/semiont/jwt-secret       → Development environment
staging/semiont/jwt-secret   → Staging environment
prod/semiont/jwt-secret      → Production environment
```

### Checklist for Production

- [ ] Generate unique random values for all secrets
- [ ] Store secrets in a secret manager (not .env files)
- [ ] Remove all hardcoded default values from configuration
- [ ] Use environment-specific OAuth apps
- [ ] Enable SSL/TLS for all database connections
- [ ] Configure managed database services with encryption at rest
- [ ] Set up secret rotation schedules
- [ ] Enable audit logging for secret access
- [ ] Document secret recovery procedures
- [ ] Test disaster recovery with secret loss scenarios
- [ ] Configure alerts for API key usage anomalies
- [ ] Review and minimize secret scope and permissions

### Example Production Environment Variables

```bash
# Authentication
JWT_SECRET=<64-char-random-string>
NEXTAUTH_SECRET=<64-char-random-string>
NEXTAUTH_URL=https://app.your-domain.com
ENABLE_LOCAL_AUTH=true

# Database
DATABASE_URL=postgresql://user:password@prod-db.region.rds.amazonaws.com:5432/semiont?sslmode=require

# AI Services (Optional)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx

# Graph Database (Optional)
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<strong-random-password>
NEO4J_DATABASE=semiont

# OAuth Providers (Optional)
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# Semiont Configuration
SEMIONT_ENV=production
SEMIONT_ROOT=/app/project
NODE_ENV=production
LOG_LEVEL=info
```

---

## GitHub Codespaces Secrets

For Codespaces deployments, you can configure secrets at the repository level:

**Repository Settings → Secrets and variables → Codespaces**

Recommended Codespaces secrets:
- `ANTHROPIC_API_KEY` - For AI features in demo
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE` - For graph features
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - If testing OAuth

**How it works:**
```json
// .devcontainer/devcontainer.json
"secrets": {
  "ANTHROPIC_API_KEY": {
    "description": "API key for Anthropic Claude AI",
    "documentationUrl": "https://console.anthropic.com/settings/keys"
  }
}
```

Codespaces automatically injects these as environment variables when the container starts.

---

## Secret Rotation

**JWT_SECRET and NEXTAUTH_SECRET:**
- Rotation invalidates all active sessions
- Plan maintenance window
- Notify users of forced logout
- Consider supporting both old and new secrets temporarily

**Database Credentials:**
- Create new credentials
- Update application configuration
- Test connectivity
- Revoke old credentials
- Update backups and monitoring

**API Keys:**
- Generate new keys
- Deploy with new keys
- Monitor for successful usage
- Revoke old keys after verification period

---

## Related Documentation

- [Container Architecture](CONTAINER.md) - Docker Compose configuration
- [Envoy Proxy Setup](ENVOY.md) - Routing and CORS configuration
- [Setup Guide](SETUP.md) - Initial setup procedures
- [NextAuth.js Documentation](https://next-auth.js.org/configuration/options)
- [Semiont Environment Configuration](https://github.com/The-AI-Alliance/semiont)

---

## Security Incident Response

**If secrets are compromised:**

1. **Immediately rotate the compromised secret**
2. Invalidate all active sessions (JWT_SECRET, NEXTAUTH_SECRET)
3. Review logs for unauthorized access
4. Audit all resources accessible with the secret
5. Document the incident and response
6. Update secret rotation procedures

**Prevention:**
- Never commit secrets to version control
- Use `.gitignore` for `.env` files
- Enable secret scanning in GitHub
- Regular security audits
- Principle of least privilege
- Monitor for anomalous usage

---

**Last Updated:** 2026-01-02
