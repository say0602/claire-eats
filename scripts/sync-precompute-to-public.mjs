import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const SOURCE_DIR = path.join(process.cwd(), "data", "precompute");
const TARGET_DIR = path.join(process.cwd(), "public", "precompute");

async function sourceExists() {
  try {
    await access(SOURCE_DIR);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await sourceExists())) {
    console.log(`[snapshot-sync] skipped: missing source dir ${SOURCE_DIR}`);
    return;
  }

  await mkdir(path.dirname(TARGET_DIR), { recursive: true });
  await rm(TARGET_DIR, { recursive: true, force: true });
  await cp(SOURCE_DIR, TARGET_DIR, { recursive: true, force: true });

  console.log(`[snapshot-sync] copied ${SOURCE_DIR} -> ${TARGET_DIR}`);
}

main().catch((error) => {
  console.error("[snapshot-sync] fatal error", error);
  process.exitCode = 1;
});
