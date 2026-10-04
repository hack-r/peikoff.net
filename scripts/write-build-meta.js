import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const builtAt = new Date().toISOString();

writeFileSync(
  new URL("../public/build-meta.json", import.meta.url),
  JSON.stringify({ commit, builtAt }, null, 2) + "\n",
);
