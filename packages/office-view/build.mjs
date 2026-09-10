import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = join(root, '../studio-web/public/office')
mkdirSync(outdir, { recursive: true })

await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  outfile: join(outdir, 'main.js'),
  sourcemap: true,
  minify: false,
  target: ['es2022'],
  loader: { '.json': 'json', '.css': 'css' },
  logLevel: 'info',
})

copyFileSync(join(root, 'src/preview.html'), join(outdir, 'preview.html'))
console.log(`[office-view] wrote ${join(outdir, 'main.js')}`)
