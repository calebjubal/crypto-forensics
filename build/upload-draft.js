"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "release");
const version = require(path.join(projectRoot, "package.json")).version;
const tag = `v${version}`;
const repository =
  process.env.GITHUB_REPOSITORY || "calebjubal/crypto-forensics";
const dryRun = process.argv.includes("--dry-run");
const checkOnly = process.argv.includes("--check");

function gh(args, options = {}) {
  return execFileSync("gh", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

const releases = JSON.parse(
  gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/releases?per_page=100`,
  ]),
).flat();
const matches = releases.filter((release) => release.tag_name === tag);

if (matches.length !== 1) {
  throw new Error(
    `Expected exactly one ${tag} release, but found ${matches.length}.`,
  );
}
if (!matches[0].draft) {
  throw new Error(`${tag} is already public; refusing to replace its assets.`);
}
if (matches[0].target_commitish !== "dev") {
  throw new Error(
    `${tag} targets ${matches[0].target_commitish}, not the dev branch.`,
  );
}

const remoteTagLines = execFileSync(
  "git",
  ["ls-remote", "--tags", "origin", `refs/tags/${tag}*`],
  { cwd: projectRoot, encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const peeledTag = remoteTagLines.find((line) => line.endsWith("^{}"));
const remoteTag = peeledTag || remoteTagLines[0];
if (remoteTag) {
  const remoteCommit = remoteTag.split(/\s+/)[0];
  const localCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
  if (remoteCommit !== localCommit) {
    throw new Error(
      `${tag} points to ${remoteCommit}, but this build is ${localCommit}.`,
    );
  }
}

if (checkOnly) {
  console.log(`${tag} draft and source tag are valid for publication.`);
  process.exit(0);
}

const releaseAssets = fs
  .readdirSync(outputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter(
    (name) =>
      /\.(?:AppImage|blockmap|deb|dmg|exe|rpm|yml|zip)$/i.test(name) &&
      !/^builder-(?:debug|effective-config)\./i.test(name),
  )
  .sort()
  .map((name) => {
    const source = path.join(outputDirectory, name);
    const safeName = name.replace(/\s+/g, "-");
    const destination = path.join(outputDirectory, safeName);
    if (source !== destination) {
      if (fs.existsSync(destination)) {
        throw new Error(`Cannot normalize duplicate asset ${safeName}.`);
      }
      fs.renameSync(source, destination);
    }
    return destination;
  });

if (releaseAssets.length === 0) {
  throw new Error(`No distributable assets were found in ${outputDirectory}.`);
}

console.log(
  `Replacing ${releaseAssets.length} asset(s) in ${tag}: ${matches[0].html_url}`,
);
if (dryRun) {
  console.log(releaseAssets.map((asset) => path.basename(asset)).join("\n"));
  process.exit(0);
}
execFileSync(
  "gh",
  [
    "release",
    "upload",
    tag,
    ...releaseAssets,
    "--clobber",
    "--repo",
    repository,
  ],
  { cwd: projectRoot, stdio: "inherit" },
);
