// Makes sure every lane in lanes.json has a token in the server's private
// tokens file. Existing tokens are kept; new lanes get a new random token.
// Usage: node tokens.mjs <lanes.json> <tokens.json>
//        node tokens.mjs <lanes.json> <tokens.json> --show <lane>   (prints one token)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const [lanesPath, tokensPath, flag, laneArg] = process.argv.slice(2);
const lanes = JSON.parse(readFileSync(lanesPath, "utf8")).lanes;
const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, "utf8")) : {};

if (flag === "--show") {
  if (!tokens[laneArg]) {
    console.error(`No token for lane "${laneArg}".`);
    process.exit(1);
  }
  console.log(tokens[laneArg]);
  process.exit(0);
}

let added = 0;
for (const name of Object.keys(lanes)) {
  if (!tokens[name]) {
    tokens[name] = randomBytes(32).toString("hex");
    added++;
  }
}
writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n", { mode: 0o640 });
console.log(`tokens: ${Object.keys(lanes).length} lane(s), ${added} new`);
