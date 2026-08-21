#!/usr/bin/env node
/**
 * Catches "Cannot access 'x' before initialization" before it ships.
 *
 * This one mistake has taken down Vantage twice and tradelane.ca once: a
 * useEffect (or useCallback/useMemo) whose dependency array names a const that
 * is declared further down the same component. Dependency arrays are evaluated
 * during render, so the reference hits JavaScript's temporal dead zone and
 * throws before anything paints — a blank page, no error on screen, and no
 * warning at build time because the code is syntactically perfect.
 *
 * The parser is deliberately simple: it reads each file, records the line where
 * every top-level const/let is declared inside a function, then checks that no
 * dependency array references one of those names from an earlier line. Simple
 * enough to trust, which matters more than catching every exotic case.
 *
 * Runs as part of `npm run build`, so a broken build fails rather than deploys.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const ROOT = 'src'
const HOOKS = /\b(useEffect|useLayoutEffect|useCallback|useMemo)\s*\(/g

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(p))) out.push(p)
  }
  return out
}

/** Line number (1-based) of a character index. */
const lineAt = (src, idx) => src.slice(0, idx).split('\n').length

/**
 * Find the dependency array that closes a hook call starting at `from`.
 * Returns { names, line } or null when the hook has no dependency array.
 */
function depsOf(src, from) {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        // Walk back from the closing paren to the last '[' — the deps array.
        const tail = src.slice(Math.max(0, i - 400), i)
        const open = tail.lastIndexOf('[')
        const close = tail.lastIndexOf(']')
        if (open === -1 || close < open) return null
        const inner = tail.slice(open + 1, close)
        const names = inner
          .split(',')
          .map(s => s.trim())
          // Bare identifiers and the roots of member expressions (a.b -> a).
          .map(s => (s.match(/^([A-Za-z_$][\w$]*)/) || [])[1])
          .filter(Boolean)
        return { names, line: lineAt(src, i) }
      }
    }
  }
  return null
}

const problems = []

/**
 * Split a file into top-level function bodies. A name declared in one component
 * says nothing about a hook in another, and comparing across them produced only
 * false positives — which is worse than no check, because a noisy check gets
 * ignored.
 */
function componentRanges(src) {
  const ranges = []
  const re = /^(?:export\s+default\s+)?(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm
  let m
  const starts = []
  while ((m = re.exec(src))) starts.push({ name: m[1], idx: m.index })
  for (let i = 0; i < starts.length; i++) {
    ranges.push({
      name: starts[i].name,
      from: starts[i].idx,
      to: i + 1 < starts.length ? starts[i + 1].idx : src.length,
    })
  }
  return ranges
}

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8')

  for (const comp of componentRanges(src)) {
    const body = src.slice(comp.from, comp.to)
    const baseLine = lineAt(src, comp.from) - 1

    // Declarations within THIS component only.
    const declLine = new Map()
    const declRe = /^[ \t]*(?:const|let)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/gm
    let d
    while ((d = declRe.exec(body))) {
      const line = baseLine + lineAt(body, d.index)
      const group = d[1] || d[2] || d[3] || ''
      for (const raw of group.split(',')) {
        const name = (raw.split(':').pop().match(/([A-Za-z_$][\w$]*)/) || [])[1]
        if (name && !declLine.has(name)) declLine.set(name, line)
      }
    }

    HOOKS.lastIndex = 0
    let h
    while ((h = HOOKS.exec(body))) {
      const deps = depsOf(body, h.index + h[0].length - 1)
      if (!deps) continue
      const hookLine = baseLine + lineAt(body, h.index)
      for (const name of deps.names) {
        const decl = declLine.get(name)
        if (decl !== undefined && decl > hookLine) {
          problems.push({ file, comp: comp.name, name, hookLine, decl })
        }
      }
    }
  }
}

if (problems.length) {
  console.error('\n\u2716 Use before declaration \u2014 this WILL render a blank page.\n')
  for (const p of problems) {
    console.error(`  ${p.file}:${p.hookLine}  (in ${p.comp})`)
    console.error(`    hook depends on "${p.name}", declared below at line ${p.decl}`)
    console.error(`    \u2192 move the hook below line ${p.decl}, or move the declaration up\n`)
  }
  console.error('Dependency arrays are evaluated during render, so a const declared')
  console.error('later is still in the temporal dead zone and throws immediately.\n')
  process.exit(1)
}

console.log('[check-tdz] no use-before-declaration issues found')
