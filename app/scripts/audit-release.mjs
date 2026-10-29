import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(app, '..')
const excluded = new Set(['node_modules', '.git', 'out', 'dist'])
const forbidden = /(^|\/)(素材库|安装包|截图|data|data-dev|runtime|backups|shots)(\/|$)|(^|\/)(AI api key\.txt|secrets\.json|credentials\.json|\.env(?:\..*)?)$|\.(pfx|p12|pem|key|yaotang|log|tsbuildinfo)$/i
const secret = /(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/
const errors = []
let checked = 0
function inspect(name, bytes) {
  if (forbidden.test(name)) errors.push(`Forbidden file: ${name}`)
  if (secret.test(bytes.toString('utf8'))) errors.push(`Credential pattern: ${name}`)
  checked++
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (excluded.has(entry.name)) continue
    if (entry.name.endsWith('.tsbuildinfo')) continue
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) { errors.push(`Unexpected symbolic link: ${entry.name}`); continue }
    if (entry.isDirectory()) walk(full)
    else inspect(path.relative(root,full).replaceAll('\\','/'), fs.readFileSync(full))
  }
}
walk(root)
if (process.argv.includes('--package')) {
  const require = createRequire(import.meta.url)
  const asar = require('@electron/asar')
  const archive = path.join(app, 'dist/win-unpacked/resources/app.asar')
  for (const entry of asar.listPackage(archive)) {
    const name = entry.replaceAll('\\','/').replace(/^\//,'')
    if (!name) continue
    const archivePath = path.normalize(name)
    const stat = asar.statFile(archive,archivePath)
    if (stat.files) continue
    if (name !== 'package.json' && !name.startsWith('out/')) errors.push(`Unexpected packaged file: ${name}`)
    inspect(name,asar.extractFile(archive,archivePath))
  }
  for (const name of ['LICENSE.txt','THIRD_PARTY_NOTICES.txt']) {
    if (!fs.existsSync(path.join(app,'dist/win-unpacked/resources',name))) errors.push(`Missing packaged license: ${name}`)
  }
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`Release audit passed: ${checked} source and packaged files checked.`)
