import { zipSync, strToU8 } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'
const root = process.argv[2], out = process.argv[3]
const files = {}
const walk = (rel) => { for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(r); else if (/^(characters|chats|worldbooks)\//.test(r) && !r.endsWith('index.json') && !r.endsWith('.tmp')) files[r] = new Uint8Array(fs.readFileSync(path.join(root, r))) } }
walk('')
const nChars = Object.keys(files).filter(k => k.endsWith('character.json')).length
files['manifest.json'] = strToU8(JSON.stringify({ format: 'yaotang-archive', version: 1, app: 'test', createdAt: Date.now(), counts: { characters: nChars, chats: Object.keys(files).filter(k => k.startsWith('chats/')).length, worldbooks: 0 }, includesSettings: false, includesSecrets: false }))
fs.writeFileSync(out, zipSync(files))
console.log('archive', nChars, 'chars', Object.keys(files).length, 'files')
