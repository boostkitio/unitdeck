// DeepSeek code review via OpenRouter — portable across projects.
//
// Fetches a PR diff, asks DeepSeek to review it, and posts the review as a
// PR comment. Works in any repo: it auto-reads the repo's own conventions
// file (AGENTS.md / CLAUDE.md / CODEBUDDY.md) and reviews generically.
//
// Env: OPENROUTER_API_KEY (required), PR_NUMBER (required), GH_TOKEN (required).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'deepseek/deepseek-v4-pro'

const apiKey = process.env.OPENROUTER_API_KEY
const prNumber = process.env.PR_NUMBER

if (!apiKey) {
  console.log('OPENROUTER_API_KEY not set, skipping DeepSeek review')
  process.exit(0)
}
if (!prNumber) {
  console.error('PR_NUMBER is not set')
  process.exit(1)
}

// Read the repo's own conventions so the review matches its house style.
function readConventions() {
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEBUDDY.md']) {
    const p = path.join(process.cwd(), name)
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8')
  }
  return ''
}
const conventions = readConventions()

const diff = execSync('gh pr diff ' + prNumber, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })

if (!diff.trim()) {
  console.log('No diff to review')
  process.exit(0)
}

const basePrompt = [
  'You are a senior full-stack engineer reviewing a pull request.',
  'Review for correctness, bugs, security, performance, accessibility and SEO.',
  'Be specific and cite file paths. Flag anything that would look broken to a visitor.',
  '',
  'Recurring bug classes to watch for:',
  '- Subtle hover background tints that leave text dark on dark.',
  '- Hardcoded CDN image URLs where a CMS or config helper should be used instead.',
  '- Fixed-height buttons whose long labels wrap or overflow.',
  '- Image elements without alt text, and broken image asset references.',
  '- One entity surfacing another entity media asset.'
].join('\n')

const systemPrompt = conventions
  ? basePrompt + '\n\nRepository conventions:\n\n' + conventions
  : basePrompt

const userPrompt = 'Review this diff and post a concise, actionable code review:' + '\n\n' + diff

const response = await fetch(OPENROUTER_BASE_URL + '/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  })
})

if (!response.ok) {
  console.error('OpenRouter error', response.status, await response.text())
  process.exit(1)
}

const data = await response.json()
const review = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content

if (!review) {
  console.error('No review text returned:', JSON.stringify(data).slice(0, 500))
  process.exit(1)
}

execSync('gh pr comment ' + prNumber + ' --body ' + JSON.stringify(review), { stdio: 'inherit' })
console.log('DeepSeek review posted to PR ' + prNumber)
