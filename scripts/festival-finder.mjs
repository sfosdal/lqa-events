// The weekly festival list (scripts/festivals.mjs has the why): reads every live site's events.json and
// city.js, finds festivals no venue names, and opens one issue in sfosdal/lqa-events — a checklist by city,
// mailed to Steve by GitHub — after closing last week's (its unticked boxes become noes). No finds, no issue.
// Run by .github/workflows/festivals.yml on Monday mornings.
//
//   node scripts/festival-finder.mjs            # print the issue it would open (no token needed)
//   GITHUB_TOKEN=… node scripts/festival-finder.mjs --open    # the workflow: close last week's, open this week's
import vm from 'node:vm';
import { detect, issueLine, readAnswers, fetchIssues, REPO, LABEL } from './festivals.mjs';

const OPEN = process.argv.includes('--open');
const token = process.env.GITHUB_TOKEN;
const today = new Date().toISOString().slice(0, 10);

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(await (await fetch('https://lqa.seattle.here.events/cities.js')).text(), ctx);
const sites = ctx.window.LQACities.cities.filter((c) => c.live && c.key !== 'hawaii') // Hawaiʻi is the islands' feeds again
  .map((c) => ({ key: c.key, name: c.name, url: c.url })); // curling.events is left out: a bonspiel is its own event, and its rows are every club's

const issues = await fetchIssues({ token });
const answers = readAnswers(issues);

const sections = [];
for (const s of sites) {
  try {
    const [feed, cityJs] = await Promise.all([fetch(s.url + 'events.json').then((r) => r.json()), fetch(s.url + 'city.js').then((r) => r.text())]);
    const c = { globalThis: {}, window: {} }; vm.createContext(c); vm.runInContext(cityJs, c);
    const CITY = c.globalThis.LQACity || c.window.LQACity;
    const skipVenues = new Set(Object.entries(CITY?.venues || {}).filter(([, v]) => v.festival).map(([k]) => k));
    const finds = detect(feed.events || feed, { city: CITY?.key || s.key, cityName: CITY?.name || s.name, today, skipVenues, decided: new Set([...answers.approved.keys(), ...answers.rejected]) });
    const fresh = finds.filter((f) => !answers.approved.has(f.key) && !answers.rejected.has(f.key));
    if (fresh.length) sections.push(`### ${s.name}\n\n${fresh.map(issueLine).join('\n')}`);
    console.error(`${s.key}: ${fresh.length} finds`);
  } catch (err) { console.error(`${s.key}: not read — ${err.message}`); }
}

const week = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const title = `Possible festivals — week of ${week}`;
const body = `Festivals no single venue names: the same name at two or more venues within ten days, read from every site's live feed.\n\n` +
  `**Tick a box to say yes** — the next daily build gives those events the festival's name (a line on each row; search finds it). ` +
  `A box still unticked when next Monday's list comes is a no, and that find is not proposed again.\n\n` + sections.join('\n\n') + '\n';

if (!OPEN) { console.log(sections.length ? `# ${title}\n\n${body}` : 'No finds this week — no issue.'); process.exit(0); }
if (!token) throw new Error('--open needs GITHUB_TOKEN');
const gh = (path, method, data) => fetch(`https://api.github.com/repos/${REPO}${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(data) })
  .then(async (r) => { if (!r.ok) throw new Error(`${method} ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); return r.json(); });
for (const is of issues.filter((i) => i.state === 'open' && !i.pull_request)) await gh(`/issues/${is.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
if (!sections.length) { console.log('No finds this week — no issue.'); process.exit(0); }
const made = await gh('/issues', 'POST', { title, body, labels: [LABEL], assignees: ['sfosdal'] });
console.log(`Opened #${made.number}: ${made.html_url}`);
