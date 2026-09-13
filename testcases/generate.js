#!/usr/bin/env node
'use strict';

/**
 * Render the PerpDEX catalogue (perpdex.cases.js) three ways and keep IDs stable.
 *
 *   node testcases/generate.js          writes .md, .xlsx and merges fixtures/testcases.json
 *   node testcases/generate.js --check  exits non-zero if the outputs are not up to date
 *
 * The .xlsx is written with the standard library only: a zip of the handful of
 * XML parts a spreadsheet needs, inline strings, one sheet. No dependency, no
 * build step, and the file opens in Excel, LibreOffice and Google Sheets.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { MARKETS } = require('./perpdex.cases');

/**
 * Each source is one sheet: a data module, the tier its cases bind to, and
 * the names of its rendered files. All sources share fixtures/testcases.json.
 */
const SOURCES = [
  { file: './perpdex.cases', tier: 'contract-perpdex', md: 'PerpDEX-TestCases.md', xlsx: 'PerpDEX-TestCases.xlsx', title: 'PerpDEX — test cases', intro: 'cases over the exchange in `../contracts`' },
  { file: './miniapi.cases', tier: null, md: 'MiniAPI-TestCases.md', xlsx: 'MiniAPI-TestCases.xlsx', title: 'mini-api — DB and API test cases', intro: 'cases over the indexer store and the REST layer in `../services/mini-api`' },
  { file: './bot.cases', tier: 'bot', md: 'Bot-TestCases.md', xlsx: 'Bot-TestCases.xlsx', title: 'bot — risk gate and operations test cases', intro: 'cases over the trading bot in `../node/be/bot` (risk gate pure; operations against PerpDEX)' },
];

const HERE = __dirname;
const FIXTURE = path.join(HERE, '..', 'fixtures', 'testcases.json');
const CHECK = process.argv.includes('--check');

const COLUMNS = ['ID', 'Module', 'Function', 'Tier', 'Title', 'Purpose', 'Precondition', 'Steps', 'Expected', 'Priority', 'Run'];

// ---------------------------------------------------------------- IDs by key

function allocateIds(fixture, cases, label) {
  const byKey = new Map();
  for (const [id, meta] of Object.entries(fixture.cases)) if (meta.key) byKey.set(meta.key, Number(id));
  let next = fixture.meta.nextId;
  const out = [];
  for (const c of cases) {
    let id = byKey.get(c.key);
    if (id === undefined) { id = next++; byKey.set(c.key, id); }
    out.push({ id, ...c });
  }
  const keys = new Set(cases.map((c) => c.key));
  if (keys.size !== cases.length) throw new Error('duplicate keys in ' + label);
  out.sort((a, b) => a.id - b.id);
  return { rows: out, nextId: next };
}

// ---------------------------------------------------------------- markdown

function renderMd(rows, src) {
  const lines = [];
  lines.push('# ' + src.title);
  lines.push('');
  lines.push(`${rows.length} ${src.intro}. Generated from \`${path.basename(src.file)}.js\`; do not edit by hand.`);
  lines.push('');
  lines.push('IDs are immutable and shared with `../fixtures/testcases.json`, which the automation binds to.');
  lines.push('');
  if (src.tier === 'contract-perpdex') {
    lines.push('The last group is parameterised over the three deployed markets:');
    lines.push('');
    lines.push('| Market | id | index | tick | step | min notional | max leverage | IM | MM |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const m of MARKETS) lines.push(`| ${m.sym}-PERP | ${m.id} | $${m.index} | ${m.tick} | ${m.step} | $${m.minNotional} | ${m.lev}x | ${m.im} | ${m.mm} |`);
    lines.push('');
  }
  let module = null;
  for (const r of rows) {
    if (r.module !== module) {
      module = r.module;
      lines.push(`## ${module}`);
      lines.push('');
    }
    lines.push(`### C${r.id} · ${r.title}`);
    lines.push('');
    lines.push(`**Function** \`${r.fn}\` · **Tier** ${r.tier} · **Priority** ${r.priority} · **Run** ${r.run}`);
    lines.push('');
    lines.push(`**Purpose.** ${r.purpose}`);
    lines.push('');
    lines.push(`**Precondition.** ${r.pre}`);
    lines.push('');
    lines.push('**Steps.**');
    r.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
    lines.push(`**Expected.** ${r.expected}`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- xlsx (standard library only)

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderXlsx(rows) {
  const col = (i) => String.fromCharCode(65 + i);
  const cell = (r, i, v) => `<c r="${col(i)}${r}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const lines = [];
  lines.push(`<row r="1">${COLUMNS.map((h, i) => cell(1, i, h)).join('')}</row>`);
  rows.forEach((r, k) => {
    const n = k + 2;
    const vals = [`C${r.id}`, r.module, r.fn, r.tier, r.title, r.purpose, r.pre, r.steps.map((s, i) => `${i + 1}) ${s}`).join('\n'), r.expected, r.priority, r.run];
    lines.push(`<row r="${n}">${vals.map((v, i) => cell(n, i, v)).join('')}</row>`);
  });
  const widths = [8, 26, 22, 12, 48, 48, 40, 80, 48, 10, 8].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${lines.join('')}</sheetData><autoFilter ref="A1:${col(COLUMNS.length - 1)}${rows.length + 1}"/></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test Case" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return zip([
    ['[Content_Types].xml', types],
    ['_rels/.rels', rels],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

// ---------------------------------------------------------------- fixture merge

function mergeFixture(fixture, rows, nextId, defaultTier) {
  const out = { meta: { ...fixture.meta, nextId }, cases: { ...fixture.cases } };
  for (const r of rows) {
    out.cases[String(r.id)] = {
      key: r.key,
      module: r.module,
      layer: r.tier,
      tier: r.bindTier || defaultTier,
      title: r.title,
      priority: r.priority,
      steps: r.steps,
    };
  }
  // keep numeric order in the file
  const ordered = {};
  for (const id of Object.keys(out.cases).map(Number).sort((a, b) => a - b)) ordered[String(id)] = out.cases[String(id)];
  out.cases = ordered;
  return out;
}

// ---------------------------------------------------------------- main

let fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const stale = [];
const outputs = [];
for (const src of SOURCES) {
  const { cases } = require(src.file);
  const { rows, nextId } = allocateIds(fixture, cases, src.file);
  const md = renderMd(rows, src);
  const xlsx = renderXlsx(rows);
  fixture = mergeFixture(fixture, rows, nextId, src.tier);
  const MD = path.join(HERE, src.md);
  const XLSX = path.join(HERE, src.xlsx);
  if (CHECK) {
    if (!fs.existsSync(MD) || fs.readFileSync(MD, 'utf8') !== md) stale.push(path.relative(process.cwd(), MD));
  } else {
    fs.writeFileSync(MD, md);
    fs.writeFileSync(XLSX, xlsx);
  }
  const ids = rows.map((r) => r.id);
  outputs.push(path.basename(src.md, '.md') + ': ' + rows.length + ' cases C' + Math.min(...ids) + '..C' + Math.max(...ids));
}
const merged = JSON.stringify(fixture, null, 2) + '\n';
if (CHECK) {
  if (fs.readFileSync(FIXTURE, 'utf8') !== merged) stale.push(path.relative(process.cwd(), FIXTURE));
  if (stale.length) {
    console.error('stale: ' + stale.join(', ') + ' -- run node testcases/generate.js');
    process.exit(1);
  }
  console.log('testcases up to date: ' + outputs.join('; '));
  process.exit(0);
}
fs.writeFileSync(FIXTURE, merged);
console.log(outputs.join('\n') + '\nnextId ' + fixture.meta.nextId);
