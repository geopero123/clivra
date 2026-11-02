// Builds demo/clivra-motion.html (publishable page fragment) and demo/standalone.html (opens from disk)
// from the template, inlining the app's real brain engine so the preview matches the app.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(mkdtempSync(join(tmpdir(), 'brain-')), 'brain.js')
execFileSync(join(root, 'node_modules/.bin/rolldown'), [join(root, 'src/renderer/src/lib/brain.ts'), '--format', 'iife', '--name', 'ClivraBrain', '--minify', '-o', out], { stdio: 'ignore' })
const frag = readFileSync(join(root, 'demo/clivra-motion.src.html'), 'utf8').replace('/*__BRAIN__*/', readFileSync(out, 'utf8'))
writeFileSync(join(root, 'demo/clivra-motion.html'), frag)
const head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0}</style>\n</head>\n<body>\n'
writeFileSync(join(root, 'demo/standalone.html'), head + frag + '\n</body>\n</html>\n')
console.log('built', frag.length, 'bytes')
