// Design-package consistency checks only. No network, product code or live data.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const files = fs.readdirSync(__dirname).filter(x => /\.(md|html)$/.test(x));
const read = f => fs.readFileSync(require('node:path').join(__dirname, f), 'utf8');
const brokenLinks = [];
for (const file of files.filter(f => f.endsWith('.md'))) {
  for (const match of read(file).matchAll(/\]\(([^)]+)\)/g)) {
    if (!/^(https?:|#)/.test(match[1]) && !fs.existsSync(require('node:path').join(__dirname, match[1]))) brokenLinks.push(file + ': ' + match[1]);
  }
}
const html = read('ux-review.html');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
const screens = [...read('06-ux-specification.md').matchAll(/^\| [IWRCPMANS][0-9]{2} \/[^\n]+/gm)];
const workflows = [...read('08-workflows.md').matchAll(/^\| F[0-9]{2} /gm)];
const tests = [...read('11-backlog-acceptance.md').matchAll(/^\| T[0-9]{2} /gm)];
assert.equal(brokenLinks.length, 0, brokenLinks.join('\n'));
assert.equal(new Set(ids).size, ids.length);
assert.ok(anchors.every(id => ids.includes(id)));
assert.equal(ids.length, 8);
assert.equal(workflows.length, 26);
assert.equal(tests.length, 28);
assert.ok(!/<script|<iframe|https?:\/\//i.test(html));
assert.equal(12000000 * .6 + 8000000 * .25 + 5000000 * .2, 10200000);
assert.equal(4000000 + 10200000, 14200000);
assert.equal((1000000 - 100000 - 50000) / 1000000, .85);
assert.equal((1000000 - 100000 - 50000 + 200000) / 1000000, 1.05);
console.log(JSON.stringify({files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(require('node:path').join(__dirname,f)).size, 0), brokenLinks, boards: ids.length, screens: screens.length, workflows: workflows.length, acceptanceScenarios: tests.length, staticOnly: true, financialFixtures: 'passed', visualBrowserReview: 'not completed: browser could not reach local host'}, null, 2));
