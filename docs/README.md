# FLUX: Deployment & Security Guide

This guide provides a clean, step-by-step approach to deploying FLUX and securing it for production. 

---

## 🏗️ 1. Architecture Overview

Here is how FLUX is structured when deployed:

```text
FLUX Production System
│
├── 🌐 Edge (Caddy/Nginx)
│   └── Handles HTTPS & Routing
│
├── 🖥️ Frontend (flux-web)
│   └── Serves the React UI
│
├── ⚙️ Backend (flux-server)
│   └── Runs the Go API & Vaults
│
└── 💾 Storage (Docker Volumes)
    ├── flux-vaults (User Notes)
    └── flux-appdata (Settings & Plugins)
```

---

## 🐳 2. Deployment & Containerization

### Why Containers?
Containers (Docker/Podman) package FLUX so it runs perfectly on any server without needing to install complex dependencies (like Go or C compilers).

### Container Isolation
Containers run separately from your main server. They can only access data through explicit "Volumes".

```text
Your Server (Host)
│
└── Docker / Podman
    │
    ├── 📦 flux-web Container
    │   └── Isolated (No access to host files)
    │
    └── 📦 flux-server Container
        └── Isolated (Accesses data via Volumes)
            ├── Volume: flux-vaults
            └── Volume: flux-appdata
```

### Implementation Steps

#### Step 1: Build the Frontend
Compile the React code into static files.
```bash
cd /path/to/flux
bun run build --filter=@flux/web
```

#### Step 2: Create Web Dockerfile
Save this as `apps/web/Dockerfile`:
```dockerfile
FROM nginx:alpine
COPY dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

#### Step 3: Create `docker-compose.yml`
Save this in your project root to run both frontend and backend together:
```yaml
services:
  web:
    build: ./apps/web
    ports:
      - "3000:80"
    networks:
      - flux-net

  server:
    build: ./server
    environment:
      ENVIRONMENT: production
      HOST: 0.0.0.0
      PORT: "8080"
      FLUX_VAULT_ROOT: /data/vaults
      CORS_ALLOWED_ORIGIN: http://localhost:3000 
    volumes:
      - flux-vaults:/data/vaults
      - flux-appdata:/app/data
    networks:
      - flux-net

networks:
  flux-net:

volumes:
  flux-vaults:
  flux-appdata:
```

#### Step 4: Run the Deployment
```bash
docker compose up -d
```
*FLUX is now live at `http://localhost:3000`.*

---

## 🔐 3. Security & RBAC

### Why Security Matters
If you deploy FLUX to the web, you must ensure traffic is encrypted (HTTPS) and only authorized users can modify files.

### Security Flow
```text
User Request
│
├── 1. Reverse Proxy (HTTPS Check)
│
├── 2. Auth Middleware (Validates User Token)
│
├── 3. RBAC Middleware (Checks User Role)
│
└── 4. API (Executes Request)
```

### Implementation Steps

#### Step 1: HTTPS (Reverse Proxy)
Use Caddy to automatically secure your site with HTTPS.
**Caddyfile:**
```text
flux.yourdomain.com {
    reverse_proxy /api/* flux-server:8080
    reverse_proxy /* flux-web:80
}
```

#### Step 2: Authentication (JWT)
Ensure users must log in before using the API.
**Add this to `server/internal/api/routes.go`:**
```go
func requireAuth(c *gin.Context) {
    token := c.GetHeader("Authorization")
    if !isValidJWT(token) {
        c.AbortWithStatusJSON(401, gin.H{"error": "Unauthorized"})
        return
    }
    c.Next()
}
```

#### Step 3: RBAC (Role-Based Access Control)
Restrict what users can do. For example, a `Viewer` cannot delete files.
**Add this to `server/internal/api/routes.go`:**
```go
func requireRole(allowedRoles ...string) gin.HandlerFunc {
    return func(c *gin.Context) {
        userRole := c.GetString("user_role")
        for _, role := range allowedRoles {
            if userRole == role {
                c.Next()
                return
            }
        }
        c.AbortWithStatusJSON(403, gin.H{"error": "Forbidden"})
    }
}
```

---

## 🧩 4. Plugin Security

### Why Plugin Security Matters
Plugins are third-party code. If a plugin is malicious, it could steal your notes. FLUX protects you by running plugins in isolated sandboxes.

### Plugin Isolation
```text
Go Backend (Host)
│
└── 🔒 Isolated Web Worker
    │
    ├── 📦 Plugin A (Note Editor)
    │   └── Granted: `vault.read`, `vault.write`
    │
    └── 📦 Plugin B (AI Helper)
        └── Granted: `vault.read`, `ai.chat`
```

### Implementation Steps

#### Step 1: Strict Capability Approvals
When enabling a plugin via API, only grant the exact permissions it needs. Never grant `*` (all permissions).
```bash
curl -X PUT http://localhost:8080/api/v1/vaults/<vault_id>/plugins/<plugin_id> \
  -H "Authorization: Bearer <token>" \
  -d '{"grantedPermissions": ["vault.read"]}'
```

#### Step 2: Secure API Keys
Keep AI keys out of plugin settings. Store them in the host environment instead.
**Add to `docker-compose.yml`:**
```yaml
environment:
  - OPENAI_API_KEY=sk-xxxx...
```

#### Step 3: Worker Safeguards
Leave the default crash limits in `VaultPluginHostOptions` alone. These ensure that if a plugin crashes 3 times, it is permanently disabled, saving your server from crashing.

---

## 🎉 Conclusion

By following these steps, you have successfully transformed FLUX from a local development environment into a production-ready, secure, and containerized application. 

**Final Checklist for Operators:**
1. Ensure your host machine has backups configured for the `flux-vaults` volume to prevent data loss.
2. Monitor your `flux-server` Docker logs periodically to check for any unauthorized access attempts or crashing plugins.
3. Keep the base Docker images (`nginx:alpine` and `alpine:3.23`) updated to receive the latest OS security patches.

*Happy deploying!*
