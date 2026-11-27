import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselinePath = resolve(root, '.comment-baseline.json')
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.svg', '.json', '.yml', '.yaml'])

function fingerprint(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

function commentsIn(source, path) {
  const extension = extname(path).toLowerCase()
  if (extension === '.html' || extension === '.svg') {
    const comments = [...source.matchAll(/<!--([\s\S]*?)-->/g)].map(match => match[1])
    if (extension === '.html') {
      for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) comments.push(...commentsIn(match[1], 'inline.js'))
      for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) comments.push(...commentsIn(match[1], 'inline.css'))
    }
    return comments
  }

  const comments = []
  let i = 0
  let state = 'code'
  const templates = []
  const expressions = []
  const lineComments = extension !== '.css'

  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]

    if (state === 'code') {
      const expression = expressions.at(-1)
      if (expression !== undefined && c === '{') {
        expression.depth++
        i++
        continue
      }
      if (expression !== undefined && c === '}') {
        if (expression.depth === 0) {
          expressions.pop()
          state = 'template'
        } else expression.depth--
        i++
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        if (c === '`') {
          templates.push('code')
          state = 'template'
        } else state = c === '"' ? 'double' : 'single'
        i++
      } else if (lineComments && c === '/' && next === '/') {
        const start = i
        i += 2
        while (i < source.length && source[i] !== '\n') i++
        const raw = source.slice(start, i)
        if (!/^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b/.test(raw)) {
          comments.push(raw.slice(2))
        }
      } else if (c === '/' && next === '*') {
        const start = i
        i += 2
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
        i = Math.min(source.length, i + 2)
        const raw = source.slice(start + 2, Math.max(start + 2, i - 2))
        comments.push(raw)
      } else {
        i++
      }
      continue
    }

    if (state === 'template') {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '$' && next === '{') {
        expressions.push({ depth: 0 })
        state = 'code'
        i += 2
        continue
      }
      if (c === '`') {
        state = templates.pop() ?? 'code'
        i++
        continue
      }
      i++
      continue
    }

    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n' && state !== 'template') state = 'code'
    else if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) state = 'code'
    i++
  }

  return comments
}

function yamlComments(source) {
  const comments = []
  for (const line of source.split('\n')) {
    let quote = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quote === '"') {
        if (c === '\\') i++
        else if (c === '"') quote = ''
      } else if (quote === "'") {
        if (c === "'" && line[i + 1] === "'") i++
        else if (c === "'") quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        comments.push(line.slice(i + 1))
        break
      }
    }
  }
  return comments
}

function currentInventory() {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(path => !path.split('/').includes('.codegraph'))
    .filter(path => extensions.has(extname(path).toLowerCase()))
    .sort()
  const inventory = {}
  for (const path of files) {
    const source = readFileSync(resolve(root, path), 'utf8')
    const counts = {}
    const comments = ['.yml', '.yaml'].includes(extname(path).toLowerCase())
      ? yamlComments(source)
      : commentsIn(source, path)
    for (const comment of comments) {
      const hash = fingerprint(comment)
      counts[hash] = (counts[hash] ?? 0) + 1
    }
    if (Object.keys(counts).length) inventory[path] = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
  }
  return inventory
}

const inventory = currentInventory()
if (process.argv.includes('--write-baseline')) {
  writeFileSync(baselinePath, `${JSON.stringify({ version: 1, files: inventory }, null, 2)}\n`)
  console.log(`Recorded comment baseline for ${Object.keys(inventory).length} files.`)
  process.exit(0)
}

let baseline
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
} catch {
  console.error('Missing or invalid .comment-baseline.json; restore it or run the explicit baseline update command.')
  process.exit(2)
}

const violations = []
for (const [path, comments] of Object.entries(inventory)) {
  for (const [hash, count] of Object.entries(comments)) {
    const allowed = baseline.files?.[path]?.[hash] ?? 0
    if (count > allowed) violations.push(`${path}: ${count - allowed} new comment(s), fingerprint ${hash.slice(0, 12)}`)
  }
}

if (violations.length) {
  console.error(`Comment ratchet failed: ${violations.length} new comment fingerprint(s).`)
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(`Comment ratchet passed across ${Object.keys(inventory).length} files.`)
