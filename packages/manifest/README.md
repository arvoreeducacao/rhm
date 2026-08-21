# @arvoretech/manifest

A workspace manifest declares **where each skill and MCP server applies**.

It deliberately does not describe skills or MCP servers themselves — those already
have formats of their own: a skill is a folder with a `SKILL.md`, an MCP server is a
server entry. Those three are settled conventions. What nobody standardised is
*which repository gets which*, and that is the only thing this file answers.

```json
{
  "$schema": "https://unpkg.com/@arvoretech/manifest/schema.json",
  "repos": ["acme/api", "acme/web"],
  "skills": {
    "delivery": "*",
    "backend-nestjs": "api",
    "design-tokens": [{ "repo": "web", "path": "src/app/writing/**" }]
  },
  "mcps": {
    "context7": "*",
    "postgres": "api"
  }
}
```

A repository is just a link. Its stack, its commands and its runtime versions are
already written in the repository itself, so `scan` reads them instead of asking
anyone to write them down twice.

## Why a central file, and not each skill declaring its own scope

The obvious alternative is for a skill to say in its own frontmatter where it
applies, the way editor rules do with globs. That breaks for vendored skills: a
skill synced from another repository, pinned by content hash, is not yours to edit
— the next sync overwrites whatever routing you wrote in it.

Routing belongs in a file the workspace owns.

## Usage

```ts
import { load, scan, resolve, reconcile } from "@arvoretech/manifest";

const manifest = load(workspaceRoot);

resolve(manifest, "web");
// { repo: "web", declared: true,
//   skills: [{ name: "delivery" }, { name: "design-tokens", path: "src/app/writing/**" }],
//   mcps: [{ name: "context7" }], envFile: ".env.local", integrations: {} }

reconcile(manifest, scan(workspaceRoot).map((r) => r.name));
// { matched, missing, undeclared, … }
```

`missing` is what the manifest lists and the disk does not have; `undeclared` is the
other way round. Both rot silently without something to compare them.

## Editor support

The schema ships as a value, not only as a file:

```ts
import { schema, schemaWith } from "@arvoretech/manifest/schema";
```

Register it inline rather than by URL. Monaco's JSON worker cannot resolve a
relative `$schema` — it would attempt an HTTP request and fail quietly — so the host
has to hand it the schema itself, with `enableSchemaRequest: false`.

`schemaWith({ skills, mcps })` returns a copy whose keys are constrained to the
names actually installed, so completion offers real skills instead of free text.
Plain JSON Schema can only express that as an enum, which is why it is built rather
than written.

Editors that resolve a relative `$schema` against the open file — VS Code and Cursor
do — work with the plain file and need none of this.

## Scope values

| Value | Applies to |
|---|---|
| `"*"` | every repository |
| `"api"` | one repository |
| `["api", "web"]` | several |
| `{ "repo": "web", "path": "src/**" }` | one repository, narrowed to a path glob |

Lists may mix plain names and narrowed targets.
