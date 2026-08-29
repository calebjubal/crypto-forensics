'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { createHash } = require('node:crypto');
const { chain } = require('stream-chain');
const { parse } = require('csv-parse');
const { parser } = require('stream-json');
const { streamArray } = require('stream-json/streamers/StreamArray');
const { SaxesParser } = require('saxes');
const { ARRAY_FIELDS, REQUIRED } = require('./validation');
const MAX_RECORD = 2 * 1024 * 1024;

async function* records(file, stats, cancelled = () => false) {
  const format = path.extname(file).slice(1).toLowerCase();
  if (!['csv', 'json', 'xml'].includes(format)) throw new Error('Supported file types: CSV, JSON, XML.');
  const digest = createHash('sha256');
  const source = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
  let stream;
  const meter = new Transform({ transform(chunk, encoding, callback) {
    if (cancelled()) return callback(new Error('Operation cancelled. No rows from this file were committed.'));
    digest.update(chunk); stats.bytes = (stats.bytes || 0) + chunk.length;
    callback(null, chunk);
  } });
  try {
    if (format === 'xml') {
      stream = chain([source, meter]);
      const xml = new SaxesParser();
      let stack = [], current = null, queue = [], size = 0;
      xml.on('doctype', () => { throw new Error('XML DTDs and external entities are forbidden.'); });
      xml.on('opentag', tag => {
        stack.push({ name: tag.name, text: '', children: [] });
        if (stack.length > 5) throw new Error('XML nesting exceeds the supported schema.');
        if (stack.length === 1 && tag.name !== 'records') throw new Error('XML root must be <records>.');
        if (stack.length === 2) {
          if (tag.name !== 'record') throw new Error('XML rows must use <record>.');
          current = {}; size = 0;
        }
      });
      xml.on('text', value => {
        size += value.length;
        if (size > MAX_RECORD) throw new Error('XML record exceeds 2 MiB.');
        if (stack.length) stack[stack.length - 1].text += value;
      });
      xml.on('cdata', value => { throw new Error('CDATA is not supported; use escaped XML text.'); });
      xml.on('closetag', () => {
        const node = stack.pop();
        if (stack.length === 3) stack[2].children.push(node.text.trim());
        if (stack.length === 2) {
          if (Object.hasOwn(current, node.name)) throw new Error(`Duplicate XML field: ${node.name}`);
          current[node.name] = ARRAY_FIELDS.includes(node.name) ? (node.children.length ? node.children : node.text.trim()) : node.text.trim();
        }
        if (stack.length === 1) { queue.push(current); current = null; }
      });
      // StringDecoder preserves UTF-8 characters split across read chunks.
      stream.setEncoding('utf8');
      for await (const chunk of stream) { xml.write(chunk); for (const row of queue) yield row; queue = []; }
      xml.close();
      for (const row of queue) yield row;
    } else if (format === 'csv') {
      const csv = parse({ bom: true, columns(headers) {
        if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV headers are not allowed.');
        for (const field of REQUIRED) if (!headers.includes(field)) throw new Error(`CSV header missing ${field}.`);
        return headers;
      }, skip_empty_lines: true, max_record_size: MAX_RECORD });
      stream = chain([source, meter, csv]);
      for await (const row of stream) yield row;
    } else {
      let depth = 0, size = 0;
      const guard = new Transform({ objectMode: true, transform(token, encoding, callback) {
        if (token.name === 'startObject' || token.name === 'startArray') depth++;
        if (depth > 32) return callback(new Error('JSON nesting exceeds 32 levels.'));
        if (token.name === 'stringChunk' || token.name === 'numberChunk') size += token.value.length;
        if (size > MAX_RECORD) return callback(new Error('JSON record exceeds 2 MiB.'));
        if (token.name === 'endObject' || token.name === 'endArray') { depth--; if (depth === 1) size = 0; }
        callback(null, token);
      } });
      // The parser emits both chunks (for early size checks) and packed values
      // required by StreamArray's record assembler.
      stream = chain([source, meter, parser(), guard, streamArray()]);
      for await (const entry of stream) yield entry.value;
    }
    stats.sha256 = digest.digest('hex');
  } finally { source.destroy(); meter.destroy(); if (stream) stream.destroy(); }
}
module.exports = { records };
