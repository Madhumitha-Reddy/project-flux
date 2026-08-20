# FLUX Deployment, Security & Architecture Design

## 1. Introduction

FLUX requires a robust deployment architecture to transition from a local development environment into a highly available, reliable production application. Currently, the development architecture optimizes for fast iteration (using `bun run dev`), but a production deployment must optimize for stability, security, and data persistence.

The goals of this deployment architecture are to make FLUX:
- **Easy to deploy**: Operators should be able to spin up the system with minimal manual configuration.
- **Reproducible**: Containerization ensures the Go backend (with its CGO SQLite dependencies) runs identically on any host.
- **Portable**: The architecture must support standard container runtimes like Docker and Podman.
- **Secure**: Network boundaries, TLS termination, and isolation must protect user data.
- **Persistent**: User vaults must survive container restarts and upgrades safely.
- **Maintainable**: Updates, backups, and logs must be easily manageable.
- **Scalable**: The architecture must support current single-user deployments while laying the groundwork for future multi-user/team deployments.

This document serves as the comprehensive engineering design for achieving these goals, providing both High-Level Design (HLD) and Low-Level Design (LLD) specifications.

---

## 2. Current FLUX Architecture

Before proposing a deployment strategy, it is critical to understand the existing FLUX architecture. 
*(Status: **Existing**)*

### 2.1 Desktop Architecture

```text
Electron Main Process
        ↓
Renderer (React UI)
        ↓
Typed Preload / IPC Bridge
        ↓
Backend / Sidecar (Go)
        ↓
Local Vault
```
In the desktop mode, Electron bundles the Go backend as a sidecar process. The React renderer communicates with the backend exclusively via a strongly-typed IPC bridge. Security is maintained locally via an auto-generated `X-Flux-Desktop-Token`.

### 2.2 Web Architecture

```text
Browser
        ↓
Vite/PWA (Frontend)
        ↓
HTTP Bridge
        ↓
Go Backend (Server)
        ↓
Vault + SQLite derived state (.flux/index.db)
```
In the web mode, the browser serves the Vite PWA application, which communicates with the Go backend over HTTP. The backend interacts directly with the filesystem to manage the Vault (Markdown files) and maintains a derived FTS5 index in SQLite.

### 2.3 Monorepo Architecture

FLUX is built as a Turborepo monorepo:
- `apps/desktop`: Electron wrapper and preload scripts (Runtime specific).
- `apps/web`: Vite + PWA web application (Runtime specific).
- `server`: Go backend using Gin and GORM (Shared backend).
- `packages/app-core`: Shared React 19 application logic used by both desktop and web.
- `packages/bridge-contract`: Typed runtime contract defining the API boundary.
- `packages/client-desktop`: Electron IPC implementation of the bridge.
- `packages/client-web`: HTTP implementation of the bridge.
- `packages/shared-domain`: Shared data models.
- `packages/shared-ui`: Tailwind CSS 4 and Radix UI components.

---

## 3. Deployment Requirements

To successfully deploy the Web Architecture, the system must meet the following requirements:

### Functional Requirements
- Web application must reliably communicate with the Go backend.
- Backend must have read/write access to the user's vault directory.
- Vault data must persist permanently.
- Users must be able to create and open vaults.
- Deployment must be reproducible across Linux environments.
- Application must restart safely without data corruption.
- Configuration (ports, origins) must be externalized via environment variables.

### Operational Requirements
- Easy startup and teardown via standard commands.
- Health check endpoints to monitor backend status.
- Standardized logging to `stdout`/`stderr`.
- Persistent storage must be easily accessible for backup support.
- Support for seamless version updates.

### Security Requirements
- HTTPS must be enforced in production via reverse proxy.
- Secrets (e.g., AI API keys) must be injected securely.
- Filesystem access must be strictly restricted to the vault boundaries.
- Authentication must protect API endpoints.
- Authorization (RBAC) must dictate user capabilities.
- Plugin sandboxing must prevent unauthorized host access.

### Deployment Requirements
- Docker and Docker Compose support.
- Podman compatibility (daemonless/rootless execution).
- One-command deployment design.
- Declarative persistent volumes.

---

## 4. Deployment HLD

High-Level Design (HLD) describes the system at the component and service level, establishing boundaries, responsibilities, and network flows without diving into exact implementation details (like file paths or specific Docker commands).

### Proposed FLUX Deployment HLD

```text
                         USER
                           │
                           │ HTTPS (Port 443)
                           ▼
                  ┌───────────────────┐
                  │   Reverse Proxy   │
                  │   TLS / Routing   │
                  └─────────┬─────────┘
                            │
              ┌─────────────┴─────────────┐
              │ HTTP                      │ HTTP (Internal)
              ▼                           ▼
      ┌───────────────┐           ┌───────────────┐
      │   FLUX Web    │           │  FLUX Server  │
      │  React / PWA  │           │   Go + Gin    │
      └───────────────┘           └───────┬───────┘
                                          │
                                          │
             Container / Host Boundary    │
  ========================================│=================
                                          │
                                          ▼
                         ┌────────────────────────────────┐
                         │       Persistent Volume        │
                         │                                │
                         │  ┌────────────────┐            │
                         │  │ Vault Storage  │            │
                         │  │ Markdown files │            │
                         │  └───────┬────────┘            │
                         │          │                     │
                         │  ┌───────▼────────┐            │
                         │  │ SQLite Index   │            │
                         │  │ .flux/index.db │            │
                         │  └────────────────┘            │
                         └────────────────────────────────┘
```

**Component Explanation:**
1. **Reverse Proxy:** Terminates TLS (HTTPS) and routes traffic. Static asset requests go to the Web container; API requests go to the Server container.
2. **FLUX Web:** A lightweight static file server serving the compiled React frontend.
3. **FLUX Server:** The core Go application processing business logic, managing plugins, and reading/writing files.
4. **Persistent Volume:** A dedicated storage area outside the container lifecycle that holds user Markdown files and the SQLite search index.

---

## 5. HLD — Component Responsibilities

*(Status: **Proposed** for Web Container and Proxy, **Existing** for Server and SQLite)*

| Component | Responsibility | Deployment Location |
|---|---|---|
| **FLUX Web** | Serves compiled React/PWA UI assets | Container (Nginx) |
| **FLUX Server** | API handling, Vault access, Plugin Host | Container (Alpine/Go) |
| **Reverse Proxy** | HTTPS termination, domain routing | Host or separate Container (Caddy/Nginx) |
| **Vault** | Canonical User data (Markdown/attachments) | Persistent Storage Volume |
| **SQLite** | Derived FTS5 search index and app state | Persistent Storage Volume (`.flux/index.db`) |
| **Docker/Podman** | Process and filesystem isolation | Host OS |
| **Volume** | Data persistence across container restarts | Host File System |

---

## 6. HLD — Deployment Models

### 6.1 Local Development *(Existing)*
```text
Developer ──▶ Bun ──▶ Vite Dev Server ──▶ Go Server ──▶ Local Vault
```

### 6.2 Self-Hosted Deployment *(Partially Implemented - Server only currently)*
```text
User ──▶ Docker/Podman ──▶ FLUX Web ──▶ FLUX Server ──▶ Persistent Vault
```
The user provisions their own hardware, installs Docker, and manages their own vault volumes.

### 6.3 Hosted Deployment *(Proposed)*
```text
Users ──▶ HTTPS ──▶ Managed Load Balancer ──▶ FLUX Web ──▶ FLUX Server ──▶ Cloud Persistent Storage
```
When moving from Self-Hosted to Hosted, the architecture requires multi-tenancy. A managed infrastructure handles TLS, scaling, and automated snapshot backups. Authentication and RBAC become strictly mandatory.

---

## 7. HLD — Single User Deployment

*(Status: **Existing** architecture, but web auth is **Proposed**)*

```text
User ──▶ FLUX Web ──▶ Personal Vault
```
**Characteristics:**
- **Authentication:** Requires a single strong password or JWT session (currently missing in web mode).
- **Vault Ownership:** The single user is the implicit owner of all vaults.
- **Storage:** A single persistent volume mounted to `/data/vaults`.
- **Backup:** Simple file-level copy of the vault directory.

---

## 8. HLD — Team Deployment

*(Status: **Not Implemented**)*

```text
                     FLUX
                       │
                Organization
                       │
                 Workspace
                       │
          ┌────────────┼────────────┐
          │            │            │
        User A       User B       User C
          │            │            │
          └────────────┼────────────┘
                       │
                Roles / Permissions
                       │
               Shared Team Vaults
```
**Characteristics:**
- **Multi-tenancy:** Requires distinct user accounts and workspace models.
- **RBAC:** Requires granular permissions to dictate who can read, write, or manage plugins.
- **Data Isolation:** Vaults must be strictly segregated by workspace permissions.

---

## 9. Deployment HLD — Network Architecture

```text
Internet
   │
   ▼ HTTPS (443) [Public Port]
Reverse Proxy (TLS Termination)
   │
   ├─▶ [Internal Port 80] ─▶ FLUX Web
   │
   └─▶ [Internal Port 8080] ─▶ FLUX Server
                   │
                   ▼ [Direct FS Access]
                 Vault
```

**Network Boundaries:**
- **Public vs Private:** Only the Reverse Proxy is exposed publicly (Ports 80/443). The Web and Server containers operate on a private Docker bridge network.
- **TLS Termination:** Happens at the edge (Reverse Proxy). Internal traffic between containers is plain HTTP.
- **CORS:** The Server must accept requests originating from the domain hosted by the Web container.

---

## 10. Deployment HLD — Storage Architecture

FLUX is a local-first knowledge management system. Storage distinction is critical.

```text
User Vault ──▶ Persistent Storage ──▶ Markdown / Attachments
```
and
```text
Vault ──▶ .flux/ ──▶ index.db
```

**Canonical vs Derived Data:**
- **Canonical Data:** The raw Markdown files and attachments. This is the absolute source of truth.
- **Derived Data:** The SQLite `.flux/index.db`. This is an FTS5 search index derived from the canonical data.

**Lifecycle Behavior:**
- **Container Restart/Recreation:** Data remains intact on the volume.
- **Host Storage Deletion:** Data is permanently lost.
- **Restore Strategy:** If `.flux/index.db` is lost or corrupted but the Markdown files exist, FLUX can theoretically rebuild the index from scratch. If Markdown files are lost, the data is gone. **Backups must target the entire Vault directory.**

---

## 11. Deployment LLD

Low-Level Design (LLD) shifts from "What components exist?" to "How exactly do we configure and connect them?" It covers specific Docker configurations, environment variables, and startup sequences.

---

## 12. LLD — Container Structure

*(Status: **Proposed**)*

**Option A: Separate Containers (Recommended)**
- `flux-web`: Runs Nginx alpine, serving static Vite output.
- `flux-server`: Runs Alpine, executing the Go binary.
*Why?* Follows microservice best practices, scales independently, and allows the web container to act as a lightweight caching layer.

**Option B: Combined Container**
- Single Alpine container running the Go binary, which also statically serves the Vite output via Gin's `StaticFS`.
*Why?* Easier for users to deploy (one image instead of two).

**Recommendation:** Go with **Option A** for enterprise/team deployments, but Option B can be evaluated for maximum simplicity in single-user environments. For this LLD, we proceed with Option A (Separate Containers) as it represents a true production architecture.

---

## 13. LLD — Dockerfile

*(Status: Server is **Existing**, Web is **Proposed**)*

### Server Dockerfile (Existing multi-stage)
```text
Build Stage ──▶ Install Alpine build-base ──▶ Go mod download ──▶ Build with CGO_ENABLED=1 (SQLite FTS5)
Runtime Stage ──▶ Alpine 3.23 ──▶ Add 'flux' non-root user ──▶ Copy Go binary ──▶ EXPOSE 8080
```
*Note:* The existing server Dockerfile correctly uses a non-root user (`flux:flux`) for security.

### Web Dockerfile (Proposed)
```text
Build Stage ──▶ Bun install ──▶ Bun run build (Vite)
Runtime Stage ──▶ Nginx Alpine ──▶ Copy /dist to /usr/share/nginx/html ──▶ EXPOSE 80
```

---

## 14. LLD — Docker Compose

*(Status: **Proposed** architecture)*

```yaml
services:
  web:
    image: flux-web:latest
    container_name: flux-web
    depends_on:
      server:
        condition: service_healthy
    networks:
      - flux-net
    restart: unless-stopped

  server:
    image: flux-server:latest
    container_name: flux-server
    environment:
      ENVIRONMENT: production
      HOST: 0.0.0.0
      PORT: "8080"
      FLUX_VAULT_ROOT: /data/vaults
      CORS_ALLOWED_ORIGIN: https://flux.yourdomain.com
    volumes:
      - flux-data:/data/vaults
    networks:
      - flux-net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped

volumes:
  flux-data:

networks:
  flux-net:
```
**Explanation:** 
- `depends_on`: Ensures the frontend doesn't start until the backend `healthcheck` passes.
- `restart: unless-stopped`: Ensures services survive host reboots.
- `flux-data` volume ensures the vault outlives the container.

---

## 15. LLD — Persistent Volumes

*(Status: **Partially Implemented** in server compose)*

```text
Host
 │
 └── /var/lib/docker/volumes/flux-data/_data/ (Managed Docker Volume)
      │
      └── vault_123/
           ├── Notes.md
           └── .flux/
                └── index.db
```
**Why internal storage is incorrect:** If the vault is stored inside the writable layer of the container (not a volume), the moment the user runs `docker compose down` or updates their image, all their notes are permanently deleted. 

Volumes must be owned by the internal `flux` non-root user (UID usually 1000 or similar). Permissions must be configured to allow the container read/write access.

---

## 16. LLD — Environment Configuration

*(Status: **Partially Implemented**)*

Relevant environment variables for the Go server:
- `ENVIRONMENT`: Set to `production` to disable debug logging.
- `HOST`: Set to `0.0.0.0` to bind to all container interfaces.
- `PORT`: Set to `8080`.
- `FLUX_VAULT_ROOT`: Set to `/data/vaults`.
- `CORS_ALLOWED_ORIGIN`: Must strictly match the frontend domain to prevent CORS vulnerabilities.

*Security Note:* Never commit `.env` files containing actual secrets (like JWT signing keys or AI provider keys) to version control. Use `.env.example` as a template.

---

## 17. LLD — Health Checks

*(Status: **Existing** endpoint)*

```text
Docker Engine ──▶ GET /health ──▶ 200 OK ──▶ Status: Healthy
```
The server exposes a `GET /health` endpoint. The Docker Compose file utilizes this via `wget`. If the backend becomes unavailable (e.g., deadlocks or crashes), Docker will mark it as `unhealthy` and attempt a restart based on the restart policy.

---

## 18. LLD — Startup Flow

*(Status: **Existing** logic)*

1. `docker compose up -d` executed.
2. `flux-server` container starts.
3. Go Backend initializes (`main.go`).
4. Configuration loaded via `config.Load()`.
5. Vault Manager initializes `/data/vaults`.
6. SQLite FTS5 index boots up for existing vaults.
7. HTTP Server (Gin) binds to `0.0.0.0:8080`.
8. `GET /health` passes.
9. `flux-web` container starts.
10. Reverse proxy routes incoming traffic.
11. User accesses FLUX.

---

## 19. LLD — Request Flow

Example: **"Create a new Markdown file"**

```text
Browser
  │ (User clicks "New File")
  ▼ HTTPS
Reverse Proxy (Caddy/Nginx)
  │
  ▼ HTTP
FLUX Web (Serves JS, JS makes API call)
  │
  ▼ POST /api/v1/vaults/:id/files
Go/Gin Handler (server/internal/api/routes.go)
  │
  ▼ Vault Service (app.CreateFile)
  │
  ▼ Filesystem (os.WriteFile inside /data/vaults/.../file.md)
  │
  ▼ SQLite (.flux/index.db updated via GORM)
  │
  ▼ Response (200 OK)
Browser
```

---

## 20. LLD — Vault Creation Flow

*(Status: **Existing** logic)*

1. User submits Vault Creation form.
2. Browser issues `POST /api/v1/vaults`.
3. Backend validates request (sanitizes vault name).
4. `os.MkdirAll` initializes the directory inside `/data/vaults/`.
5. `.flux` directory is created.
6. `index.db` SQLite database is generated and schema migrated.
7. Vault UUID is returned to the client.

---

## 21. LLD — Vault Persistence

- **Container stops:** Data remains on the Docker Volume.
- **Container restarts:** Data remains intact.
- **Container is recreated (Update):** Data remains intact (Volume is re-attached).
- **Container is deleted (`docker rm`):** Data remains intact.
- **Host storage / Volume is deleted (`docker volume rm`):** **DATA IS LOST.**

---

## 22. LLD — Update Strategy

```text
New FLUX Release (v1.1)
  │
  ▼ docker compose pull
Pull new image layers
  │
  ▼ docker compose up -d
Stop Old Container ──▶ Start New Container
  │
  ▼
Mount same 'flux-data' persistent volume
  │
  ▼
Go Server runs GORM AutoMigrate on index.db
  │
  ▼
Deployment Complete
```

---

## 23. LLD — Backup and Restore

**Backup:**
Operators must back up the physical host directory mapped to the Docker volume (or use a volume backup container). 
Because FLUX relies on plain Markdown files (Canonical), backing up the `/data/vaults/` directory captures both the raw files and the `.flux/index.db` (Derived state).

**Restore:**
Restore the directory to the host, point the Docker volume to it, and start the containers. FLUX will read the existing Markdown files seamlessly.

---

## 24. Docker vs Podman LLD

*(Status: **Proposed** Compatibility)*

Both engines utilize `docker-compose.yml` (Podman via `podman-compose` or `podman compose`).
- **Docker (`docker compose up -d`)**: Runs the daemon as root. Volumes have straightforward permissions.
- **Podman (`podman compose up -d`)**: Runs rootless. **Compatibility Concern**: Volume permission mapping inside rootless containers can cause `Permission Denied` errors when the Go application attempts to write to the vault. Administrators must use `podman unshare chown` to align host UIDs with the container's `flux` user namespace.

---

## 25. One-Click Deployment Design

*(Status: **Not Implemented**)*

**Proposed User Experience:**
```bash
curl -fsSL https://get.flux.app | bash
```
**Script Actions:**
1. Verifies Docker/Podman is installed.
2. Downloads `docker-compose.yml`.
3. Prompts user for a domain (for Caddy HTTPS).
4. Creates local `./data` directory for bind mounts.
5. Executes `docker compose up -d`.
6. Prints the success URL.

---

## 26. Security Architecture

*(Status: **Partially Implemented**)*

```text
User Request
  │
  ▼ Authentication (Web JWT / Desktop Token)
  │
  ▼ Authorization (RBAC / Policies)
  │
  ▼ API Layer (Gin)
  │
  ▼ Vault (Filesystem boundaries enforced)
```
**Enforcements:**
- Security MUST be enforced at the Go Backend.
- Path traversal protection (e.g., preventing `../../../etc/passwd` requests) is currently handled via Go `filepath.Clean` in the Vault service.
- The web frontend currently lacks user authentication.

---

## 27. RBAC HLD

*(Status: **Not Implemented** for standard users; **Existing** conceptually for MCP connections)*

**Proposed Role Hierarchy for Team Deployment:**
- **Owner**: Full workspace management, user invitations, vault deletion, plugin installation.
- **Editor**: Read, write, and create files inside assigned vaults. Cannot install plugins.
- **Viewer**: Read-only access to vaults. Cannot modify files or settings.

---

## 28. RBAC LLD

*(Status: **Proposed**)*

**Implementation in Go/Gin:**
```text
HTTP Request
  │
  ▼ Auth Middleware (Extracts JWT → identifies User ID)
  │
  ▼ RBAC Middleware (Queries DB: "Does User ID have 'Editor' role in Vault ID?")
  │
  ▼ Permission Check Passes
  │
  ▼ Gin Handler Executed
```
Requires new GORM models: `User`, `Workspace`, `WorkspaceRole`.

---

## 29. Plugin Security

Plugins (Git, AI, Excalidraw) pose massive risks because they execute third-party JavaScript.
- **Risks:** Unauthorized file access, exfiltration of notes over the network, leakage of AI API credentials, arbitrary code execution.

---

## 30. Plugin Security HLD

*(Status: **Existing**)*

```text
Third-Party Plugin Code
  │
  ▼ Plugin Client API (Restricted sandbox interface)
  │
  ▼ Permission Layer (Validates capabilities like `vault.read`)
  │
  ▼ FLUX Go Backend (Executes the actual host operation)
  │
  ▼ Vault
```
Plugins NEVER touch the filesystem directly. They ask the Go Backend to do it, and the Backend checks permissions first.

---

## 31. Plugin Security LLD

*(Status: **Existing**)*

**FLUX Approach:** **SES Sandbox + Web Worker**

| Approach | Security | Complexity | Performance | Recommendation |
|---|---|---|---|---|
| Same-process | Poor | Low | High | Unsafe |
| **Worker + SES** | **High** | **Medium** | **Medium** | **CURRENT FLUX IMPL** |
| Separate OS Process | Very High | High | Low | Overkill |

FLUX implements an excellent security boundary: Plugins run inside an SES (Secure ECMAScript) Compartment, which is executed inside a Web Worker (`VaultPluginHost`). It is isolated from the DOM, Node.js APIs, and global memory.

---

## 32. Secure Frontend ↔ Backend Communication

**Desktop (Existing):**
Renderer ──▶ Preload Script ──▶ Strongly Typed IPC ──▶ Go Backend
*(Secure via OS-level process isolation and auto-generated `X-Flux-Desktop-Token`).*

**Web (Proposed for Production):**
Browser ──▶ HTTPS ──▶ Reverse Proxy ──▶ Go Backend
*(Requires TLS, strict CORS origins, and JWT-based Authentication to prevent CSRF and unauthorized API usage).*

---

## 33. Encryption

*(Status: **Not Implemented** for at-rest)*

- **Encryption in Transit:** Achieved via Reverse Proxy (HTTPS/TLS).
- **Encryption at Rest:** Because FLUX relies on local-first, plain-text Markdown files for ease of editing and portability, file-level encryption at rest breaks basic OS-level search and external editor compatibility.
- **Design Decision:** Encryption at rest should be handled at the **Block Storage / OS Level** (e.g., LUKS on Linux, FileVault on macOS) rather than encrypting individual Markdown files via the application layer, preserving FLUX's canonical Markdown architecture.

---

## 34. Deployment Sequence

```text
                         USER
                           │
                         HTTPS
                           │
                           ▼
                 ┌───────────────────┐
                 │   Reverse Proxy   │
                 └─────────┬─────────┘
                           │
                           ▼
                  ┌─────────────────┐
                  │    FLUX Web     │
                  └─────────┬───────┘
                            │
                        HTTP/API
                            │
                            ▼
                 ┌───────────────────┐
                 │    Go Backend     │
                 └─────────┬─────────┘
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       ┌───────────┐               ┌────────────┐
       │ Vault Data│               │ SQLite DB  │
       └─────┬─────┘               └─────┬──────┘
             │                           │
             ▼                           ▼
    ┌───────────────────────────────────────────┐
    │           Persistent Docker Volume        │
    └───────────────────────────────────────────┘
```
**End-to-end flow:** The user connects securely via HTTPS to the proxy. The proxy serves the frontend UI. The UI makes API calls back through the proxy to the Go Backend. The Backend validates permissions and performs safe reads/writes to the physical Markdown files residing permanently in the Docker volume.

---

## 35. Implementation Checklist

### Deployment
- [x] Production Dockerfile (Server)
- [x] Multi-stage build (Server)
- [x] Persistent volumes (Server)
- [x] Health checks (Server)
- [ ] Production Dockerfile (Web)
- [ ] Unified Docker Compose
- [ ] Environment configuration externalization (Web Auth)
- [ ] Podman rootless permission testing
- [ ] One-command deployment script
- [ ] Production HTTPS guide

### Security
- [x] Path traversal protection
- [x] Desktop Token Auth
- [ ] Web Authentication (JWT)
- [ ] Authorization / RBAC Models
- [ ] Rate limiting
- [ ] Secret management (AI keys injected via env)

### Plugins
- [x] Permission model (`flux.plugin.json`)
- [x] Plugin isolation (SES Compartments)
- [x] Secure plugin communication boundary (Web Workers)
- [ ] Granular network restriction UI for `network.fetch`

---

## 36. HLD vs LLD Summary

| Area | HLD | LLD |
|---|---|---|
| **Deployment** | Components and architecture diagram | Dockerfiles, Compose YAML, volumes, ports |
| **Networking** | Network boundaries (Public vs Private) | Internal Docker networks, proxy Caddyfiles |
| **Storage** | Persistent storage vs ephemeral containers | Volume/bind mount mapping, Linux permissions |
| **Security** | Security boundaries and trust zones | Auth Middleware code, JWT verification, Secrets env |
| **RBAC** | Roles (Owner/Editor) and relationships | Go GORM Models, Role checking middleware |
| **Plugins** | Plugin trust and isolation boundaries | SES Compartment code, Capability validation APIs |

*HLD defines the architecture and strategy. LLD defines how that architecture is actively configured and coded.*
