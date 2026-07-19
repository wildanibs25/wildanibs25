import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.GITHUB_REPOSITORY_OWNER || "wildanibs25";
const token = process.env.GITHUB_TOKEN;

if (!token) {
  throw new Error("GITHUB_TOKEN is required.");
}

const query = `
  query ProfileStatistics($login: String!) {
    user(login: $login) {
      repositories(
        first: 100
        ownerAffiliations: OWNER
        privacy: PUBLIC
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          isFork
          stargazerCount
          forkCount
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": `${username}-profile-statistics`,
  },
  body: JSON.stringify({
    query,
    variables: { login: username },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub API returned HTTP ${response.status}.`);
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(payload.errors.map(({ message }) => message).join("; "));
}

const user = payload.data?.user;

if (!user) {
  throw new Error(`GitHub user "${username}" was not found.`);
}

const repositories = user.repositories.nodes.filter((repository) => !repository.isFork);
const contributions = user.contributionsCollection;
const stars = repositories.reduce((total, repository) => total + repository.stargazerCount, 0);
const forks = repositories.reduce((total, repository) => total + repository.forkCount, 0);

const languageTotals = new Map();

for (const repository of repositories) {
  for (const edge of repository.languages.edges) {
    const current = languageTotals.get(edge.node.name) || {
      name: edge.node.name,
      color: edge.node.color || "#8b949e",
      size: 0,
    };

    current.size += edge.size;
    languageTotals.set(edge.node.name, current);
  }
}

const languages = [...languageTotals.values()]
  .sort((left, right) => right.size - left.size)
  .slice(0, 6);

const totalLanguageSize = languages.reduce((total, language) => total + language.size, 0);
const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const formatNumber = (value) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const stats = [
  ["Commits (year)", contributions.totalCommitContributions],
  ["Pull requests", contributions.totalPullRequestContributions],
  ["Issues", contributions.totalIssueContributions],
  ["Code reviews", contributions.totalPullRequestReviewContributions],
  ["Public repos", user.repositories.totalCount],
  ["Stars / Forks", `${stars} / ${forks}`],
];

const statsRows = stats
  .map(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = column === 0 ? 34 : 270;
    const y = 82 + row * 42;

    return `
      <text x="${x}" y="${y}" class="label">${escapeXml(label)}</text>
      <text x="${x}" y="${y + 20}" class="value">${escapeXml(
        typeof value === "number" ? formatNumber(value) : value,
      )}</text>
    `;
  })
  .join("");

const statsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="220" viewBox="0 0 500 220" role="img" aria-label="${escapeXml(username)} GitHub statistics">
  <style>
    .card { fill: #1a1b27; stroke: #30363d; }
    .title { fill: #70a5fd; font: 700 19px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .label { fill: #a9b1d6; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .value { fill: #ffffff; font: 700 16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  </style>
  <rect class="card" x="0.5" y="0.5" width="499" height="219" rx="10"/>
  <text x="26" y="39" class="title">${escapeXml(username)}'s GitHub Stats</text>
  ${statsRows}
</svg>`;

const languageRows = languages
  .map((language, index) => {
    const percentage = totalLanguageSize ? (language.size / totalLanguageSize) * 100 : 0;
    const y = 78 + index * 25;

    return `
      <circle cx="28" cy="${y - 4}" r="5" fill="${escapeXml(language.color)}"/>
      <text x="42" y="${y}" class="language">${escapeXml(language.name)}</text>
      <text x="330" y="${y}" text-anchor="end" class="percentage">${percentage.toFixed(1)}%</text>
    `;
  })
  .join("");

const languagesSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220" viewBox="0 0 360 220" role="img" aria-label="${escapeXml(username)} most used languages">
  <style>
    .card { fill: #1a1b27; stroke: #30363d; }
    .title { fill: #70a5fd; font: 700 19px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .language { fill: #ffffff; font: 600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .percentage { fill: #a9b1d6; font: 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .note { fill: #737aa2; font: 10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  </style>
  <rect class="card" x="0.5" y="0.5" width="359" height="219" rx="10"/>
  <text x="22" y="39" class="title">Most Used Languages</text>
  ${languageRows || '<text x="22" y="85" class="language">No public language data yet</text>'}
  <text x="22" y="205" class="note">Based on public, non-fork repositories</text>
</svg>`;

await mkdir("profile", { recursive: true });
await Promise.all([
  writeFile("profile/stats.svg", statsSvg),
  writeFile("profile/top-langs.svg", languagesSvg),
]);

console.log("Profile statistics generated successfully.");
