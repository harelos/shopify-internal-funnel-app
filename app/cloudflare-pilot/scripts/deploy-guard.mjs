#!/usr/bin/env node
// The only door to production.
//
// Every fix to the CJ cost pipeline in September was real and every one was
// undone by the next deploy from a different folder: eleven copies of the
// matcher existed on one laptop and production flipped between them. This
// script makes a deploy provable instead of hopeful: it runs only from a
// clean checkout of master that matches GitHub, refuses any folder carrying a
// DO-NOT-DEPLOY marker, and stamps the Worker with the commit it came from so
// /api/version can always answer "what is live?".
//
//   npm run deploy            -> production, master only, must equal origin/master
//   npm run deploy:staging    -> staging, any branch, clean tree only

import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const target = argv.includes("--target") ? argv[argv.indexOf("--target") + 1] : "production";
if (!["production", "staging"].includes(target)) refuse(`unknown target '${target}'.`);

const cwd = process.cwd();
if (existsSync(resolve(cwd, "DO-NOT-DEPLOY"))) {
  refuse(`this checkout is marked DO-NOT-DEPLOY:\n  ${cwd}`);
}

let top, branch, sha, dirty;
try {
  top = git("rev-parse --show-toplevel");
  branch = git("branch --show-current");
  sha = git("rev-parse HEAD");
  dirty = git("status --porcelain --untracked-files=no");
} catch (error) {
  refuse(`not inside a git checkout (${error.message}).`);
}

if (dirty) {
  refuse(`the working tree has uncommitted changes to tracked files:\n${dirty}\n` +
    `Production runs committed code only. Commit or discard, then deploy.`);
}

if (target === "production") {
  if (branch !== "master") {
    refuse(`production deploys only from master; this checkout is on '${branch || "a detached HEAD"}'.`);
  }
  try { git("fetch -q origin master"); } catch {
    refuse("could not reach GitHub to confirm this commit is on origin/master.");
  }
  const remote = git("rev-parse origin/master");
  if (remote !== sha) {
    refuse(`HEAD ${sha.slice(0, 7)} is not origin/master ${remote.slice(0, 7)}.\n` +
      `Push first (or pull) so production always equals GitHub.`);
  }
}

// Colons are the --var separator, so the timestamp is written without them.
const stamp = {
  BUILD_SHA: sha.slice(0, 12),
  BUILD_BRANCH: branch || "detached",
  BUILD_TIME: new Date().toISOString().replace(/[:.]/g, "").replace(/\d{3}Z$/, "Z"),
  BUILD_FROM: top.replace(/\\/g, "/"),
};

const args = [
  "wrangler", "deploy",
  ...(target === "staging" ? ["--env", "staging"] : []),
  ...Object.entries(stamp).flatMap(([key, value]) => ["--var", `${key}:${value}`]),
];

console.log(`[deploy-guard] ${target}: ${stamp.BUILD_SHA} on ${stamp.BUILD_BRANCH} from ${stamp.BUILD_FROM}`);
const result = spawnSync("npx", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);

function git(command) {
  return execSync(`git ${command}`, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function refuse(message) {
  console.error(`\n[deploy-guard] REFUSED: ${message}\n\nSee DEPLOYING.md at the repository root.\n`);
  process.exit(1);
}
