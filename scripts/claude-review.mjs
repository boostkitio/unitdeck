// Claude code review via the Anthropic Messages API, portable across projects.
//
// Fetches a PR diff, asks Claude Haiku 5.5 to review it, and posts the review
// as a PR comment. Works in any repo: it auto-reads the repo's own conventions
// file (AGENTS.md / CLAUDE.md / CODEBUDDY.md) and reviews generically.
//
// Plain fetch on purpose: the workflow runs this without installing the
// repo's dependencies.
//
// Env: ANTHROPIC_REVIEW_API_KEY (required), PR_NUMBER (required), GH_TOKEN (required),
//      CLAUDE_REVIEW_MODEL (optional, defaults to claude-haiku-5-5).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-5-5'

const apiKey = process.env.ANTHROPIC_REVIEW_API_KEY
const prNumber = process.env.PR_NUMBER

if (!apiKey) {
  console.log('ANTHROPIC_REVIEW_API_KEY not set, skipping Claude review')
  process.exit(0)
}
if (!prNumber) {
  console.error('PR_NUMBER is not set')
  process.exit(1)
}
if (!/^\d+$/.test(prNumber)) {
  console.error('PR_NUMBER must be numeric, got: ' + prNumber)
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

// Arguments are passed as a list, never through a shell: the review text comes
// from a model that has just read a diff anybody can write, and a shell would
// run whatever it put inside $(...) with the workflow's tokens to hand.
const diff = execFileSync('gh', ['pr', 'diff', prNumber], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })

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

const response = await fetch(ANTHROPIC_URL, {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: process.env.CLAUDE_REVIEW_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  }),
  signal: AbortSignal.timeout(10 * 60 * 1000)
})

if (!response.ok) {
  console.error('Anthropic API error', response.status, await response.text())
  process.exit(1)
}

const data = await response.json()

if (data.stop_reason === 'refusal') {
  console.log('Claude declined to review this diff, skipping comment')
  process.exit(0)
}

// The response can start with thinking blocks, so collect the text blocks by type.
const review = (data.content || [])
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('\n')
  .trim()

if (!review) {
  console.error('No review text returned, stop_reason:', data.stop_reason)
  process.exit(1)
}

const bodyFile = path.join(process.env.RUNNER_TEMP || process.cwd(), 'claude-review.md')
fs.writeFileSync(bodyFile, review)
execFileSync('gh', ['pr', 'comment', prNumber, '--body-file', bodyFile], { stdio: 'inherit' })
console.log('Claude review posted to PR ' + prNumber)
