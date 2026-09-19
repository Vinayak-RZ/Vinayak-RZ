#!/usr/bin/env node
/**
 * Generates assets/stats.svg from GitHub GraphQL — no third-party card host.
 * Requires: GH_TOKEN or GITHUB_TOKEN in env, optional GH_USER (default Vinayak-RZ).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const login = process.env.GH_USER || "Vinayak-RZ";
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!token) {
  console.error("Missing GH_TOKEN / GITHUB_TOKEN");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    name
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar { totalContributions }
      restrictedContributionsCount
    }
    repositoriesContributedTo(
      first: 1
      contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
    ) { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      nodes { stargazerCount }
    }
    pullRequests { totalCount }
    issues { totalCount }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "vinayak-rz-profile-stats",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

if (!res.ok) {
  console.error("GitHub GraphQL HTTP", res.status, await res.text());
  process.exit(1);
}

const payload = await res.json();
if (payload.errors) {
  console.error(JSON.stringify(payload.errors, null, 2));
  process.exit(1);
}

const u = payload.data.user;
const cc = u.contributionsCollection;
const stars = u.repositories.nodes.reduce((s, n) => s + n.stargazerCount, 0);
const commits = cc.totalCommitContributions + (cc.restrictedContributionsCount || 0);
const total = cc.contributionCalendar.totalContributions;
const prs = u.pullRequests.totalCount;
const issues = u.issues.totalCount;
const contribTo = u.repositoriesContributedTo.totalCount;

const rows = [
  ["Total Contributions", total],
  ["Commits (year)", commits],
  ["Pull Requests", prs],
  ["Issues", issues],
  ["Stars (owned)", stars],
  ["Repos contributed to", contribTo],
];

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const rowH = 44;
const startY = 110;
const cards = rows
  .map(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 40 + col * 560;
    const y = startY + row * (rowH + 16);
    return `
  <rect x="${x}" y="${y}" width="520" height="${rowH}" fill="#18181b" stroke="#27272a" stroke-width="1"/>
  <rect x="${x}" y="${y}" width="6" height="${rowH}" fill="#e11d48"/>
  <text x="${x + 24}" y="${y + 28}" fill="#a3a3a3" font-family="Consolas, Monaco, monospace" font-size="14">${esc(label)}</text>
  <text x="${x + 496}" y="${y + 28}" text-anchor="end" fill="#fafafa" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${esc(value)}</text>`;
  })
  .join("\n");

const height = startY + 3 * (rowH + 16) + 40;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}">
  <rect width="1200" height="${height}" fill="#0a0a0a"/>
  <text x="40" y="42" fill="#e11d48" font-family="Consolas, Monaco, monospace" font-size="13" letter-spacing="4">GITHUB STATS</text>
  <text x="40" y="78" fill="#fafafa" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">${esc(u.name || login)}</text>
  <text x="1160" y="78" text-anchor="end" fill="#525252" font-family="Consolas, Monaco, monospace" font-size="12">updated by action · no live widget</text>
${cards}
</svg>
`;

mkdirSync(join(root, "assets"), { recursive: true });
const out = join(root, "assets", "stats.svg");
writeFileSync(out, svg, "utf8");
console.log("Wrote", out, { total, commits, prs, issues, stars, contribTo });
