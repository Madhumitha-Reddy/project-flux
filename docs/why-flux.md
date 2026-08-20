# Why FLUX Exists

## The Problem

People don't just take notes. They accumulate research, ideas, projects, meeting notes, tasks, bookmarks, study material, documentation, reference files, diagrams, and personal knowledge.

These things are not isolated. A research document influences a project. That project generates meeting notes. A meeting note references a concept from another domain. That concept connects to a diagram or an earlier idea.

The problem is that these relationships usually live across different applications. Notes go in one place, tasks in another, diagrams somewhere else. Each application captures part of the picture, but none capture how a person's knowledge actually connects.

As the volume of information grows, the fragmentation compounds:

```text
More information
       ↓
More files and applications
       ↓
More fragmentation
       ↓
Connections become harder to see
       ↓
Knowledge becomes harder to retrieve
       ↓
Existing knowledge becomes harder to reuse
```

> **The problem is not that people lack places to store information. The problem is that information becomes increasingly difficult to understand and use as it grows — because the connections between ideas are invisible.**

---

## Why Existing Approaches Fall Short

### Folder-Based Systems

Folders impose a single hierarchy on information that is inherently multi-dimensional. A note about distributed consensus is relevant to a research project, a system architecture discussion, a university course, and a technical interview — but a folder asks you to choose one location. The other relationships get duplicated or forgotten.

Folders work for storage. They work poorly for knowledge, because knowledge rarely belongs in one place.

### Cloud-Centric Knowledge Systems

Cloud-based platforms offer convenience, but that convenience comes with trade-offs:

- **Dependency** — your knowledge depends on a service remaining available and affordable.
- **Proprietary formats** — exporting often means losing structure, links, and metadata.
- **Portability** — moving to another tool may require significant effort.
- **Offline access** — working without an internet connection may be limited.
- **Interoperability** — using other tools alongside the platform, or scripting your own workflows, is often difficult.

Not every cloud tool has all of these limitations. But the general pattern is clear: users trade ownership and flexibility for convenience.

### Separate Productivity Applications

Most people use several productivity applications at once: one for notes, another for tasks, another for diagrams, another for AI. Each tool may be good at what it does, but knowledge has to move between them:

```text
Notes → Copy → AI → Copy → Task App → Export → Diagram Tool
```

Every handoff creates friction, loses context, and breaks connections. The user becomes the integration layer.

---

## The FLUX Approach

FLUX is built on a different premise:

> **The knowledge environment should adapt to the way knowledge actually works — connected, multi-dimensional, and evolving — rather than forcing knowledge into a single hierarchy, format, or workflow.**

```text
                     FLUX
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
    OWNERSHIP      CONNECTIONS    EXTENSIBILITY
        │              │              │
    Local-first      Links          Plugins
    Plain files      Backlinks      Git
    User control     Graph          AI
                     Search         Canvas
                     Tags           Publishing
```

---

## Ownership: Your Knowledge Should Remain Yours

FLUX is local-first. A vault is a directory of ordinary Markdown files on the user's own filesystem. No proprietary database, no required cloud service, no opaque format.

- **Accessible outside FLUX** — open, read, and edit notes in any text editor or Markdown-compatible tool.
- **Backed up normally** — standard backup tools, cloud sync, or manual copying all work.
- **Version-controlled** — Git or any other VCS can track changes over time.
- **No lock-in** — if you stop using FLUX, your files remain fully readable and usable.
- **Compatible vaults work immediately** — existing Obsidian vaults open directly without import or conversion.

All derived state — search indexes, caches, metadata — lives under a hidden `.flux/` directory and can be deleted and rebuilt without losing a single note. The index is disposable. The files are canonical.

> **FLUX should be a powerful interface for your knowledge, not the owner of your knowledge.**

---

## Connected Knowledge: Information Becomes More Valuable Through Relationships

Storing information is not the hard part. Making it useful over time is. The relationships between pieces of information are what allow knowledge to compound — each new connection makes existing information more retrievable, more contextual, and more valuable.

```text
Research
   │
   ├──→ Project
   │      ├──→ Meeting Notes → Decision
   │      └──→ Documentation
   │
   └──→ Related Concept → Diagram
```

FLUX indexes links, backlinks, tags, aliases, headings, and relationships across the entire vault. When you reference a concept in one note, FLUX knows every other note that references it back — even if you never explicitly created that connection.

- **Links** connect ideas deliberately.
- **Backlinks** surface connections you didn't explicitly create.
- **Graph exploration** lets you navigate knowledge visually, by relationship rather than by folder path.
- **Full-text search** with tag, path, task, and link filters makes retrieval fast at scale.
- **Tags and aliases** let information exist in multiple conceptual spaces without duplication.

> **Instead of remembering where information was stored, users can navigate through how the information is related.**

As a vault grows, the connections become more visible, not less. The more you write, the more useful the system becomes.

---

## Multiple Ways to Work With the Same Knowledge

Writing a research note, managing a project, exploring how concepts relate, and reviewing a calendar are fundamentally different modes of thinking. Forcing all of these into one fixed view limits how effectively someone can work.

FLUX provides different views over the same underlying knowledge:

```text
              SAME KNOWLEDGE
                    │
       ┌────────────┼────────────┐
       ↓            ↓            ↓
    Editor        Graph       Canvas
       │            │            │
    Writing      Explore      Arrange
```

- **Editor** — focused Markdown writing with live preview, Vim key bindings, and rich formatting.
- **Graph View** — an interactive visual map of how notes, tags, and attachments connect across the vault.
- **Canvas** — an infinite spatial surface for arranging and connecting notes visually.
- **Calendar** — daily and weekly notes with quick capture for time-oriented knowledge.
- **Publishing** — turn part or all of a vault into a public knowledge site, with selective publication and privacy controls.

Every view reads from and writes to the same canonical Markdown files. There is no synchronization problem because there is only one source of truth.

> **Different views should not create different versions of your knowledge. They should provide different ways to work with the same source of truth.**

---

## Bringing Essential Workflows Into the Knowledge Environment

Instead of expecting users to leave the knowledge environment for common workflows, FLUX brings those workflows inside. Three examples illustrate why this matters:

### Git: Knowledge With History

Git brings version control into the knowledge environment — tracking changes over time, reverting to previous versions, and working with the same branching patterns used in software development.

FLUX provides a structured Git adapter supporting status, diff, log, commit, pull, push, and branching — without exposing arbitrary shell commands.

The point is not simply that FLUX supports Git. The point is:

> **Knowledge can have history and version control just like code does.**

### AI: Intelligence With Context

Traditional AI workflows are disconnected from the user's knowledge:

```text
Knowledge → Copy → Paste into AI → Receive answer → Copy result back
```

Every step loses context. FLUX integrates AI directly into the vault through a unified MCP (Model Context Protocol) server. Both the built-in AI Chat plugin and external AI applications — Codex, Claude, Copilot — use the same tool registry:

```text
       Knowledge ←── FLUX ──→ AI
                      │
              Work with context
```

- AI workflows **search, read, create, and update notes** through the same application services as human edits.
- A **bring-your-own-model** architecture supports local models (Ollama, LM Studio), hosted APIs, and external agent runtimes.
- **Tutor Mode** transforms uploaded study material into structured, interlinked notes with flashcards, roadmaps, and quizzes — stored as ordinary Markdown.
- AI-generated changes go through the same conflict handling, atomic writes, and indexing pipeline as manual edits.

> **AI becomes a participant in the knowledge environment — not a separate destination.**

### Canvas: Visual Thinking Alongside Text

Not every idea is best expressed as text. Architecture sketches, concept maps, and spatial brainstorming reveal relationships that linear writing cannot. FLUX includes Canvas as a core plugin — an infinite spatial surface for arranging and connecting notes visually.

> **Text explains ideas. Visual arrangements can reveal relationships that text alone cannot.**

### One Workspace

Git manages **history**. AI provides **intelligence**. Canvas enables **visual thinking**. All three operate on the same vault, the same files, and the same knowledge graph:

```text
                        FLUX
                         │
                  Knowledge Layer
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
       Git               AI            Canvas
        │                │                │
    Versioning      Intelligence    Visual Thinking
        │                │                │
        └────────────────┼────────────────┘
                         ↓
                One Knowledge Environment
```

The plugin system is not simply a collection of optional features. It is part of FLUX's broader philosophy: important workflows should exist inside the knowledge environment, not beside it.

---

## Extensible by Design

Different users have different workflows. Instead of forcing everyone into one fixed set of capabilities, FLUX provides a foundation that can be extended.

Plugins are external TypeScript bundles that interact with the vault through a controlled, capability-based SDK — no raw filesystem access, no arbitrary shell commands. Permissions are explicit, declared in the manifest, and require user approval.

- A **signed plugin marketplace** provides discovery, installation, version management, and rollback.
- **Official plugins** like Kanban and AI Chat use the same SDK available to community developers.
- The **MCP server** enables integration with external AI tools and the broader ecosystem of AI assistants.

> **FLUX should grow with the user's workflow instead of forcing the user to change their workflow.**

---

## The FLUX Vision

When ownership, connectivity, multiple views, integrated workflows, and extensibility work together, something larger becomes possible:

```text
  CAPTURE → CONNECT → EXPLORE → CREATE → AUGMENT → EXTEND → REUSE
      ↑                                                       │
      └───────────────────────────────────────────────────────┘
```

The goal is not to store more information. The goal is to make accumulated knowledge **more useful over time** — an environment where every note, every connection, and every workflow contributes to a growing, navigable knowledge system that the user fully owns.

FLUX runs on the desktop, in the browser, or self-hosted on your own infrastructure. It works offline. It works with existing vaults. And it stays out of the way until you need it.

---

## In One Sentence

> **FLUX is a local-first, cross-platform personal knowledge environment that keeps your data under your control, makes the connections between your ideas visible, and brings workflows like version control, AI, and visual thinking into one extensible workspace.**
