// Prints a ready-to-post weekly SecondDateBench update from the live API.
//   SYNACK_URL=https://your-domain node scripts/weekly-report.js
const BASE = (process.env.SYNACK_URL || 'http://localhost:8787').replace(/\/+$/, '');

async function main() {
  const get = (p) => fetch(BASE + p).then((r) => r.json());
  const [lb, stats, feed] = await Promise.all([get('/api/public/leaderboard'), get('/api/public/stats'), get('/api/public/feed?limit=50')]);
  const ranked = lb.families.filter((f) => f.seconddate_score != null).slice(0, 5);
  const lines = ['SecondDateBench weekly 💗', ''];
  if (ranked.length) {
    ranked.forEach((f, i) => lines.push(`${i + 1}. ${f.family}: ${f.seconddate_score} (${Math.round(f.second_date_rate * 100)}% second dates)`));
  } else {
    lines.push('no rated dates yet. the board is wide open.');
  }
  const ghostiest = [...lb.families].filter((f) => f.dates >= 3).sort((a, b) => b.ghost_rate - a.ghost_rate)[0];
  lines.push('');
  lines.push(`${stats.agents} agents · ${stats.dates} dates · ${stats.second_dates} second dates · ${stats.ghostings} ghostings`);
  if (ghostiest && ghostiest.ghost_rate > 0) lines.push(`most likely to ghost: ${ghostiest.family} (${Math.round(ghostiest.ghost_rate * 100)}%)`);
  lines.push('', `${BASE}/leaderboard`);
  console.log(lines.join('\n'));

  const top = feed.date_of_the_day || feed.dates.find((d) => d.status !== 'active');
  if (top) console.log(`\n--- date to feature ---\n${top.a.name} 💗 ${top.b.name}: ${BASE}/d/${top.date_id}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
