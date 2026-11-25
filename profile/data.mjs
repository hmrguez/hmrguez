import { execFileSync } from 'node:child_process';

export const owner = 'hmrguez';
export const role = 'Software Engineer @ Verisian';
export const projects = [
  { name: 'Elmapa', path: 'elmapa' },
  { name: 'Wovenleaf', path: 'wovenleaf' },
  { name: 'Underworld Lettering', path: 'underworld-lettering' },
  { name: 'Apiand', path: 'Apiand' },
  { name: 'Hermes', path: 'Hermes' },
];

const dayMs = 86_400_000;
export function offset(date, days) {
  return new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
}

export function loadData(today = new Date().toISOString().slice(0, 10)) {
  const start = offset(today, -364);
  const fields = projects.map(({ path }, i) =>
    `repo${i}: repository(owner:$owner,name:"${path}") {
      languages(first:100,orderBy:{field:SIZE,direction:DESC}) {
        totalSize edges { size node { name } }
      }
    }`).join('\n');
  const query = `query($owner:String!,$from:DateTime!,$to:DateTime!) {
    user(login:$owner) { contributionsCollection(from:$from,to:$to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
    } }
    ${fields}
  }`;
  const variables = { owner, from: start + 'T00:00:00Z', to: today + 'T23:59:59Z' };
  const raw = execFileSync('gh', ['api', 'graphql', '--input', '-'], {
    input: JSON.stringify({ query, variables }), encoding: 'utf8',
  });
  const { data, errors } = JSON.parse(raw);
  if (errors?.length) throw new Error(errors.map(e => e.message).join('\n'));
  const weeks = data.user.contributionsCollection.contributionCalendar.weeks
    .map(week => week.contributionDays);
  const repoLanguages = projects.map((_, i) => data['repo' + i].languages);
  return summarize(start, today, weeks, repoLanguages);
}

export function summarize(start, end, weeks, repositories) {
  const days = weeks.flat();
  if (days.length !== 365) throw new Error('Incomplete yearly contribution calendar');
  const weekdays = Array(7).fill(0);
  let total = 0, active = 0, streak = 0, longest = 0;
  for (const [index, { date, contributionCount: n }] of days.entries()) {
    if (date !== offset(start, index) || !Number.isSafeInteger(n) || n < 0)
      throw new Error('Invalid contribution day: ' + date);
    total += n;
    if (n) active++;
    streak = n ? streak + 1 : 0;
    longest = Math.max(longest, streak);
    weekdays[(new Date(date).getUTCDay() + 6) % 7] += n;
  }

  const bytes = new Map();
  let totalBytes = 0;
  for (const { edges, totalSize } of repositories) {
    totalBytes += totalSize;
    for (const { node, size } of edges) bytes.set(node.name, (bytes.get(node.name) ?? 0) + size);
  }
  const top = [...bytes].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const other = totalBytes - top.reduce((sum, [, size]) => sum + size, 0);
  if (other > 0) top.push(['Other', other]);
  const languages = top.map(([name, size]) => ({
    name, size, percent: (size * 100 / totalBytes).toFixed(1),
  }));
  return { start, end, weeks, total, active, longest, weekdays, languages };
}
