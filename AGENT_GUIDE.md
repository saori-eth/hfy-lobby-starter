# Hyperfy V2 World Setup — Agent Operations Guide

You are setting up a local Hyperfy V2 world. Hyperfy is a browser-based 3D virtual world platform. This guide will walk you through downloading a bootstrapper script, running it against a wallet address to import an existing world, and starting a local dev server. Follow every step in order.

---

## 1. What You Are Building

You will end up with a local project directory containing a Hyperfy world that runs as a Node.js dev server. The world will be viewable in a browser. The process is:

1. Download a single bootstrapper script (`main.mjs`)
2. Run it with a wallet address — it downloads that wallet's exported world data, scaffolds an SDK project, and imports everything
3. Start the dev server with `npm run dev`

---

## 2. System Requirements

The following CLI tools must be installed and available on `PATH`. Check each one before proceeding. If any check fails, install the missing tool before continuing.

```bash
node --version    # Must be v22 or higher (the Hyperfy SDK requires Node 22+)
npm --version     # Must be v8 or higher
sqlite3 --version # Any version
unzip -v          # Any version (just needs to be present)
```

### Install commands if missing

```bash
# macOS (via Homebrew)
brew install node sqlite3 unzip

# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y nodejs npm sqlite3 unzip
```

---

## 3. Download the Bootstrapper Script

The bootstrapper is a single file. It has zero npm dependencies — it uses only Node.js built-in modules. Download it:

```bash
mkdir hfy-lobby-starter && cd hfy-lobby-starter
curl -O https://raw.githubusercontent.com/saori-eth/hfy-lobby-starter/refs/heads/main/main.mjs
```

You should now have a file called `main.mjs` in your current directory. You can verify it downloaded correctly:

```bash
head -1 main.mjs
# Expected output: #!/usr/bin/env node
```

If you cannot use `curl`, you can fetch the script contents from the URL above using any HTTP client and save them to `main.mjs`.

The full source is available at:
**https://raw.githubusercontent.com/saori-eth/hfy-lobby-starter/refs/heads/main/main.mjs**

---

## 4. Run the Script

You need a **wallet address** (Ethereum-style, 0x-prefixed, 40 hex characters). This identifies which Hyperfy V2 world to download and import.

```bash
node main.mjs 0x<WALLET_ADDRESS>
```

Example with a placeholder address:

```bash
node main.mjs 0xAbC1230000000000000000000000000000000000
```

The address format must match: `0x` followed by exactly 40 hexadecimal characters (`0-9`, `a-f`, `A-F`). The script lowercases it automatically.

**Do not run the script with no arguments** — that enters interactive mode which requires a TTY and will hang in non-interactive environments. Always pass the address as an argument.

### What the script does when you run it

1. **Downloads** a zip from `https://pub-5b58d055a8e54abb845bb0c78c4ab4f5.r2.dev/exports/v2/<address>.zip`
2. **Extracts** the zip to a temp directory
3. **Reads `manifest.json`** inside the zip to discover worlds (there may be one or more)
4. **For each world**, creates a sibling directory named after the world's slug:
   - Copies the zip into `<slug>/hyperfy-export/` for future re-imports
   - Runs `npx gamedev@latest init` to scaffold the Hyperfy SDK project
   - Runs `npm install` to install SDK dependencies
   - Reads a SQLite database from the export to extract blueprints, entities, and config
   - Creates `apps/` directory with one subfolder per blueprint, each containing an `index.js` script and a `<name>.json` metadata file
   - Copies asset files (`.glb` models, `.hdr`/`.jpg` images, etc.) into `assets/`
   - Writes `world.json` with world settings, spawn point, and entity placements
   - Adds an `import:v2` npm script to `package.json`
5. **Cleans up** all temp files

### Expected log output (in order)

```
[setup] downloading export for 0x...
[setup] downloaded X.X MB
[setup] extracting <filename>.zip...
[setup] found N world(s): slug1, slug2
[setup] creating ./slug/
[setup] scaffolding SDK...
[setup] installing dependencies...
[setup] importing world: slug
  [app] $scene
  [app] SomeAppName
  [app] AnotherApp
  N apps, M entities, F files
[setup] ./slug/ is ready!
  cd slug && npm run dev
```

If the export contains multiple worlds, the above repeats for each one.

### Possible errors and what to do

| Error | Meaning | Action |
|---|---|---|
| `[setup] no export found for address 0x...` | The download server returned 404 | The wallet address has no exported world. Double-check the address. |
| `[setup] manifest.json not found in zip` | The zip doesn't contain expected structure | The zip is corrupt or not a Hyperfy export. Re-obtain it. |
| `[setup] db.sqlite not found for world "slug"` | Export is incomplete for that world | Re-export from Hyperfy. |
| `[setup] directory ./slug/ already exists` | A previous run already created this | Delete the existing directory (`rm -rf slug`) and re-run. |
| `sqlite3: command not found` | sqlite3 not installed | Install it (see section 2). |
| `unzip: command not found` | unzip not installed | Install it (see section 2). |
| `[setup] invalid address format` | Address doesn't match `0x` + 40 hex chars | Fix the address format. |
| Script hangs with no output | Entered interactive mode (no address arg) | Kill it (`Ctrl+C`) and re-run with the address as an argument. |

---

## 5. Verify the Setup

After the script finishes, verify the created project. Replace `slug` with the actual directory name from the output:

```bash
cd slug

# All of these must exist:
test -f world.json          && echo "OK: world.json"
test -d apps                && echo "OK: apps/"
test -d assets              && echo "OK: assets/"
test -d node_modules        && echo "OK: node_modules/"
test -f package.json        && echo "OK: package.json"
test -d hyperfy-export      && echo "OK: hyperfy-export/"
```

All six should print `OK`. If `node_modules/` is missing, run `npm install`.

---

## 6. Start the World

From inside the project directory:

```bash
npm run dev
```

Expected behavior:
- The terminal prints a local URL (typically `http://localhost:3000` or similar)
- The server runs in the foreground and does not exit on its own
- Open the URL in a browser to see the 3D world
- Press `Ctrl+C` to stop the server

If `npm run dev` fails with a missing script error, try `npx gamedev dev` directly — the dev command name may vary by SDK version.

---

## 7. Project Structure After Setup

```
slug/
├── apps/                        # One subfolder per blueprint
│   ├── $scene/                  # The scene (always present)
│   │   ├── $scene.json          # Blueprint config: model path, props, flags
│   │   └── index.js             # Script entry point
│   └── MyApp/
│       ├── MyApp.json
│       └── index.js
├── assets/                      # Model and prop files (.glb, .hdr, .jpg, etc.)
├── hyperfy-export/              # Original export zip (for re-imports)
│   └── <address>.zip
├── node_modules/
├── package.json
└── world.json                   # World settings, spawn point, entity list
```

### Key file formats

**`world.json`** — Top-level world config:
```json
{
  "formatVersion": 2,
  "settings": { "title": "...", "playerLimit": 3, "voice": "spatial", ... },
  "spawn": { "position": [0, 1, 0], "quaternion": [0, 0, 0, 1] },
  "entities": [
    { "id": "...", "blueprint": "AppName", "position": [x, y, z], ... }
  ]
}
```

**`apps/<name>/<name>.json`** — Blueprint metadata:
```json
{
  "scriptFormat": "module",
  "model": "assets/filename.glb",
  "props": { ... },
  "preload": false,
  "public": false,
  "locked": false,
  "frozen": false,
  "unique": false,
  "scene": false,
  "disabled": false
}
```

**`apps/<name>/index.js`** — App script (module format):
```js
export default function main(world, app, fetch, props, setTimeout) {
  // world logic here
}
```

---

## 8. Re-importing World Data

To re-run the import without re-scaffolding the SDK (e.g., after placing an updated zip in `hyperfy-export/`):

```bash
# From inside the project directory
npm run import:v2
```

This is equivalent to running `node ../main.mjs --import-only` from inside the project directory, which looks for a zip in `hyperfy-export/` and re-imports from it.

---

## 9. Full Workflow Summary

```bash
# 1. Check prerequisites
node --version && npm --version && sqlite3 --version && which unzip

# 2. Download the bootstrapper
mkdir hfy-lobby-starter && cd hfy-lobby-starter
curl -O https://raw.githubusercontent.com/saori-eth/hfy-lobby-starter/refs/heads/main/main.mjs

# 3. Run it (replace with real wallet address)
node main.mjs 0xYOUR_WALLET_ADDRESS_HERE

# 4. Enter the world directory (replace with slug from output)
cd <world-slug>

# 5. Start the server
npm run dev
```
