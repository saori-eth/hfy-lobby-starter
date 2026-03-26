#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { pipeline } from "node:stream/promises";

// Hyperfy V2 World Bootstrapper
//
// Usage:
//   node setup.mjs                        -> prompt for wallet address, download, scaffold
//   node setup.mjs 0xABC...               -> download export for address, scaffold
//   node setup.mjs path/to/export.zip     -> use local zip, scaffold
//   node setup.mjs --import-only          -> re-import in current project (skip scaffold)

const EXPORT_BASE_URL =
  "https://pub-5b58d055a8e54abb845bb0c78c4ab4f5.r2.dev/exports/v2";

const args = process.argv.slice(2);
const importOnly = args.includes("--import-only");
const noDev = args.includes("--no-dev");
let input = args.find((a) => !a.startsWith("--"));

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 11)) {
    console.error(`[setup] requires Node >=22.11.0 (current: ${process.versions.node})`);
    process.exit(1);
  }

  let zipPath;

  if (importOnly) {
    // Re-import mode: find zip in hyperfy-export/ within current project
    zipPath = await findLocalZip(process.cwd());
    await importInto(process.cwd(), zipPath);
    return;
  }

  // --- Resolve input: address, local zip, or prompt ---
  if (!input) {
    input = await promptAddress();
  }

  if (isAddress(input)) {
    zipPath = await downloadExport(input);
  } else {
    zipPath = path.resolve(input);
    if (!existsSync(zipPath)) {
      console.error(`[setup] file not found: ${input}`);
      process.exit(1);
    }
  }

  // --- Extract zip, discover worlds, scaffold each ---
  const tmpDir = path.join(
    os.tmpdir(),
    `hfy-setup-${randomBytes(4).toString("hex")}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    console.log(`[setup] extracting ${path.basename(zipPath)}...`);
    execSync(`unzip -q -o "${zipPath}" -d "${tmpDir}"`);

    const { extractDir, worlds } = await readManifest(tmpDir);

    const created = [];

    for (const worldMeta of worlds) {
      const slug = worldMeta.slug || worldMeta.folder;
      const projectDir = path.resolve(slug);

      if (existsSync(projectDir)) {
        console.error(
          `[setup] directory ./${slug}/ already exists — skipping (delete it first to re-scaffold)`,
        );
        continue;
      }

      console.log(`\n[setup] creating ./${slug}/`);
      await fs.mkdir(projectDir, { recursive: true });

      // Copy zip into project for future re-imports
      const exportDir = path.join(projectDir, "hyperfy-export");
      await fs.mkdir(exportDir, { recursive: true });
      await fs.copyFile(zipPath, path.join(exportDir, path.basename(zipPath)));

      // Scaffold SDK
      console.log("[setup] scaffolding SDK...");
      execSync("npx gamedev@latest init", {
        cwd: projectDir,
        stdio: "inherit",
      });
      console.log("[setup] installing dependencies...");
      execSync("npm install", { cwd: projectDir, stdio: "inherit" });

      // Import world content
      await importWorld(extractDir, worldMeta, projectDir);

      // Post-setup
      await addNpmScript(projectDir);
      await initialSync(projectDir);

      console.log(`\n[setup] ./${slug}/ is ready!`);
      created.push({ slug, projectDir });
    }

    // Launch dev server
    if (!noDev && created.length === 1) {
      console.log(`\n[setup] starting dev server...\n`);
      execSync("npm run dev", { cwd: created[0].projectDir, stdio: "inherit" });
    } else if (!noDev && created.length > 1) {
      console.log(`\n[setup] ${created.length} worlds created:`);
      created.forEach((w, i) => console.log(`  ${i + 1}) ${w.slug}`));
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const answer = await rl.question("\nWhich world to start? [number or q to quit]: ");
        const choice = parseInt(answer.trim(), 10);
        if (choice >= 1 && choice <= created.length) {
          console.log(`\n[setup] starting ${created[choice - 1].slug}...\n`);
          execSync("npm run dev", { cwd: created[choice - 1].projectDir, stdio: "inherit" });
        }
      } finally {
        rl.close();
      }
    } else if (noDev && created.length > 0) {
      for (const w of created) {
        console.log(`  cd ${w.slug} && npm run dev`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    // Clean up downloaded zip if we fetched it
    if (isAddress(input) && existsSync(zipPath)) {
      await fs.rm(zipPath, { force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function isAddress(str) {
  return /^0x[a-fA-F0-9]{40}$/.test(str);
}

async function promptAddress() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question("Wallet address (0x...): ");
    const trimmed = answer.trim().toLowerCase();
    if (!isAddress(trimmed)) {
      console.error("[setup] invalid address format");
      process.exit(1);
    }
    return trimmed;
  } finally {
    rl.close();
  }
}

async function downloadExport(address) {
  const url = `${EXPORT_BASE_URL}/${address.toLowerCase()}.zip`;
  const dest = path.join(os.tmpdir(), `${address.toLowerCase()}.zip`);

  console.log(`[setup] downloading export for ${address}...`);
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      console.error(`[setup] no export found for address ${address}`);
    } else {
      console.error(`[setup] download failed: ${res.status} ${res.statusText}`);
    }
    process.exit(1);
  }

  await pipeline(res.body, createWriteStream(dest));
  const stat = await fs.stat(dest);
  console.log(
    `[setup] downloaded ${(stat.size / 1024 / 1024).toFixed(1)} MB`,
  );
  return dest;
}

// ---------------------------------------------------------------------------
// Manifest / export reading
// ---------------------------------------------------------------------------

async function readManifest(extractDir) {
  let manifestPath = path.join(extractDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    for (const entry of await fs.readdir(extractDir)) {
      const candidate = path.join(extractDir, entry, "manifest.json");
      if (existsSync(candidate)) {
        manifestPath = candidate;
        extractDir = path.join(extractDir, entry);
        break;
      }
    }
  }

  if (!existsSync(manifestPath)) {
    console.error("[setup] manifest.json not found in zip");
    process.exit(1);
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const worlds = manifest.worlds || [];
  if (worlds.length === 0) {
    console.error("[setup] no worlds found in manifest");
    process.exit(1);
  }

  console.log(
    `[setup] found ${worlds.length} world(s): ${worlds.map((w) => w.slug || w.title).join(", ")}`,
  );
  return { extractDir, worlds };
}

// ---------------------------------------------------------------------------
// --import-only helper
// ---------------------------------------------------------------------------

async function findLocalZip(projectDir) {
  const exportDir = path.join(projectDir, "hyperfy-export");
  if (!existsSync(exportDir)) {
    console.error("[setup] hyperfy-export/ not found in current directory");
    process.exit(1);
  }
  const zips = (await fs.readdir(exportDir)).filter((f) =>
    f.toLowerCase().endsWith(".zip"),
  );
  if (zips.length === 0) {
    console.error("[setup] no .zip files in hyperfy-export/");
    process.exit(1);
  }
  return path.join(exportDir, zips[0]);
}

async function importInto(projectDir, zipPath) {
  const tmpDir = path.join(
    os.tmpdir(),
    `hfy-setup-${randomBytes(4).toString("hex")}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    console.log(`[setup] extracting ${path.basename(zipPath)}...`);
    execSync(`unzip -q -o "${zipPath}" -d "${tmpDir}"`);
    const { extractDir, worlds } = await readManifest(tmpDir);

    for (const worldMeta of worlds) {
      await importWorld(extractDir, worldMeta, projectDir);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// World import (core conversion logic)
// ---------------------------------------------------------------------------

async function importWorld(extractDir, worldMeta, projectDir) {
  const slug = worldMeta.slug || worldMeta.folder;
  const v2Dir = path.join(extractDir, "v2", slug);
  const dbPath = path.join(v2Dir, "db.sqlite");
  const exportAssetsDir = path.join(v2Dir, "assets");

  if (!existsSync(dbPath)) {
    console.error(`[setup] db.sqlite not found for world "${slug}"`);
    return;
  }

  console.log(`[setup] importing world: ${slug}`);

  // Read DB
  const config = {};
  for (const row of sqliteQuery(dbPath, "SELECT key, value FROM config")) {
    config[row.key] = JSON.parse(row.value);
  }

  const blueprints = sqliteQuery(
    dbPath,
    "SELECT id, data FROM blueprints",
  ).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));

  const entities = sqliteQuery(dbPath, "SELECT id, data FROM entities").map(
    (r) => JSON.parse(r.data),
  );

  // Blueprint ID → app name
  const bpToApp = new Map();
  const usedNames = new Set();
  for (const bp of blueprints) {
    const name =
      bp.id === "$scene"
        ? "$scene"
        : deriveAppName(bp.name || bp.id, usedNames);
    bpToApp.set(bp.id, name);
    usedNames.add(name);
  }

  const appsDir = path.join(projectDir, "apps");
  const assetsDir = path.join(projectDir, "assets");
  await fs.mkdir(appsDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  let fileCount = 0;

  for (const bp of blueprints) {
    const appName = bpToApp.get(bp.id);
    const appDir = path.join(appsDir, appName);
    await fs.mkdir(appDir, { recursive: true });

    // Model
    let modelPath = null;
    if (bp.model) {
      const file = resolveAssetUrl(bp.model);
      if (file) {
        const ext = path.extname(file) || ".glb";
        const dest =
          appName === "$scene" ? `scene-model${ext}` : `${appName}${ext}`;
        const src = path.join(exportAssetsDir, file);
        if (existsSync(src)) {
          await fs.copyFile(src, path.join(assetsDir, dest));
          modelPath = `assets/${dest}`;
          fileCount++;
        }
      }
    }

    // Script
    let wroteScript = false;
    if (bp.script) {
      const file = resolveAssetUrl(bp.script);
      if (file) {
        const src = path.join(exportAssetsDir, file);
        if (existsSync(src)) {
          let code = await fs.readFile(src, "utf8");
          code = ensureModuleWrapper(code);
          await fs.writeFile(path.join(appDir, "index.js"), code);
          wroteScript = true;
        }
      }
    }
    if (!wroteScript) {
      await fs.writeFile(
        path.join(appDir, "index.js"),
        "export default function main(world, app, fetch, props, setTimeout) { }\n",
      );
    }
    fileCount++;

    // Props with asset URLs
    const props = {};
    for (const [key, value] of Object.entries(bp.props || {})) {
      if (value && typeof value === "object" && value.url) {
        const file = resolveAssetUrl(value.url);
        if (file) {
          const ext = path.extname(file);
          const dest = `${appName === "$scene" ? "scene" : appName}-${key}${ext}`;
          const src = path.join(exportAssetsDir, file);
          if (existsSync(src)) {
            await fs.copyFile(src, path.join(assetsDir, dest));
            fileCount++;
          }
          const v = { ...value, url: `assets/${dest}` };
          delete v.name;
          delete v.type;
          props[key] = v;
        } else {
          props[key] = value;
        }
      } else {
        props[key] = value;
      }
    }

    // Blueprint JSON
    const appJson = {
      scriptFormat: "module",
      image: null,
      author: bp.author ?? null,
      url: bp.url ?? null,
      desc: bp.desc ?? null,
      model: modelPath,
      props,
      preload: bp.preload ?? false,
      public: bp.public ?? false,
      locked: bp.locked ?? false,
      frozen: bp.frozen ?? false,
      unique: bp.unique ?? false,
      ...(bp.scene ? { keep: true } : {}),
      scene: bp.scene ?? false,
      disabled: bp.disabled ?? false,
    };
    await fs.writeFile(
      path.join(appDir, `${appName}.json`),
      JSON.stringify(appJson, null, 2) + "\n",
    );
    fileCount++;

    console.log(`  [app] ${appName}`);
  }

  // world.json
  const worldData = {
    formatVersion: 2,
    settings: {
      title: config.settings?.title ?? null,
      desc: config.settings?.desc ?? null,
      image: config.settings?.image ?? null,
      avatar: config.settings?.avatar ?? null,
      customAvatars: config.settings?.customAvatars ?? false,
      voice: config.settings?.voice ?? "spatial",
      rank: config.settings?.rank ?? 0,
      playerLimit: config.settings?.playerLimit ?? 3,
      ao: config.settings?.ao ?? true,
    },
    spawn: config.spawn || { position: [0, 1, 0], quaternion: [0, 0, 0, 1] },
    entities: entities.map((e) => ({
      id: e.id,
      blueprint: bpToApp.get(e.blueprint) || e.blueprint,
      position: e.position || [0, 0, 0],
      quaternion: e.quaternion || [0, 0, 0, 1],
      scale: e.scale || [1, 1, 1],
      pinned: e.pinned ?? false,
      props: e.props || {},
      state: e.state || {},
    })),
  };
  await fs.writeFile(
    path.join(projectDir, "world.json"),
    JSON.stringify(worldData, null, 2) + "\n",
  );

  await bumpUploadLimit(projectDir, assetsDir);
  await resetSyncState(projectDir);

  console.log(
    `  ${blueprints.length} apps, ${entities.length} entities, ${fileCount} files`,
  );
}

// ---------------------------------------------------------------------------
// Post-import helpers
// ---------------------------------------------------------------------------

async function bumpUploadLimit(projectDir, assetsDir) {
  const envPath = path.join(projectDir, ".env");
  if (!existsSync(envPath)) return;

  let env = await fs.readFile(envPath, "utf8");
  const match = env.match(/PUBLIC_MAX_UPLOAD_SIZE=(\d+)/);
  const currentMb = match ? parseInt(match[1], 10) : 12;

  let maxBytes = 0;
  for (const file of await fs.readdir(assetsDir)) {
    const stat = await fs.stat(path.join(assetsDir, file));
    if (stat.size > maxBytes) maxBytes = stat.size;
  }

  if (maxBytes > currentMb * 1024 * 1024) {
    const neededMb = Math.ceil(maxBytes / 1024 / 1024) + 10;
    env = match
      ? env.replace(/PUBLIC_MAX_UPLOAD_SIZE=\d+/, `PUBLIC_MAX_UPLOAD_SIZE=${neededMb}`)
      : env.trimEnd() + `\nPUBLIC_MAX_UPLOAD_SIZE=${neededMb}\n`;
    await fs.writeFile(envPath, env);
    console.log(`  upload limit: ${currentMb} → ${neededMb} MB`);
  }
}

async function resetSyncState(projectDir) {
  const lobbyDir = path.join(projectDir, ".lobby");
  if (!existsSync(lobbyDir)) return;

  for (const file of ["sync-state.json", "blueprint-index.json"]) {
    const p = path.join(lobbyDir, file);
    if (existsSync(p)) await fs.rm(p);
  }
  for (const entry of await fs.readdir(lobbyDir)) {
    if (entry.startsWith("local-")) {
      const p = path.join(lobbyDir, entry);
      if ((await fs.stat(p)).isDirectory()) {
        await fs.rm(p, { recursive: true, force: true });
      }
    }
  }
}

async function initialSync(projectDir) {
  console.log("[setup] syncing project to world...");
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const child = spawn("npx", ["gamedev", "dev"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, BIDIRECTIONAL_SYNC: "false" },
      detached: true,
    });

    let output = "";
    const onData = (data) => {
      const text = data.toString();
      process.stderr.write(`  [sync] ${text}`);
      output += text;
      if (output.includes("Connected to")) {
        setTimeout(() => {
          try { process.kill(-child.pid, "SIGTERM"); } catch {}
          finish();
        }, 2000);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", finish);
    child.on("error", finish);

    setTimeout(() => {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      finish();
    }, 120000);
  });
}

async function addNpmScript(projectDir) {
  const pkgPath = path.join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  if (!pkg.scripts) pkg.scripts = {};
  if (!pkg.scripts["import:v2"]) {
    pkg.scripts["import:v2"] = "node ../setup.mjs --import-only";
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function resolveAssetUrl(url) {
  if (!url || typeof url !== "string") return null;
  return url.startsWith("asset://") ? url.slice(8) : null;
}

function deriveAppName(name, usedNames) {
  let clean = name.replace(/\.\w+$/, "").replace(/[^a-zA-Z0-9\s_-]/g, "");
  let pascal = clean
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  if (!pascal) pascal = "App";
  let candidate = pascal;
  let n = 2;
  while (usedNames.has(candidate)) candidate = `${pascal}${n++}`;
  return candidate;
}

function ensureModuleWrapper(code) {
  if (
    /export\s+default\s+function\s+main\s*\(\s*world\s*,\s*app\s*,\s*fetch\s*,\s*props\s*,\s*setTimeout\s*\)\s*\{/.test(
      code,
    )
  )
    return code;
  return `export default function main(world, app, fetch, props, setTimeout) {\n${code}\n}\n`;
}

function sqliteQuery(dbPath, query) {
  const out = execSync(`sqlite3 -json "${dbPath}" "${query}"`, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : [];
}

await main();
