'use strict';

const { hash } = require('./validation');

// Synthetic fixtures use RFC 5737 documentation IP ranges and non-wallet identifiers.
function demoRows(count = 360) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const flagged = i % 47 === 0, group = Math.floor(i / 6);
    const value = flagged ? 145 + i : (i % 27 + 1) * 0.018;
    const fee = flagged ? value * 0.08 : 0.00003;
    const input_addresses = [`demo_input_${group.toString().padStart(5,'0')}`, `demo_partner_${group.toString().padStart(5,'0')}`];
    const outputCount = flagged ? 14 : 2;
    const output_amounts = Array.from({ length: outputCount }, () => (value / outputCount).toFixed(8));
    const outputTotal = output_amounts.reduce((sum,a) => sum+Math.round(Number(a)*1e8),0);
    const inputTotal = outputTotal+Math.round(fee*1e8);
    const date = new Date(Date.UTC(2026,7,12 + i % 12, 8+Math.floor(i/12)%10, i%45, i%59));
    const row = { timestamp: date.toISOString(), src_ip: `192.0.2.${1+i%36}`, dst_ip: `198.51.100.${1+i%12}`,
      src_port: 42000+i, dst_port: 8333, txid: hash(`SYNTHETIC-NOT-CHAIN-DATA-${i}`), input_addresses,
      output_addresses: Array.from({ length: outputCount }, (_,j) => `demo_output_${i.toString().padStart(5,'0')}_${j}`),
      input_amounts: [(Math.floor(inputTotal/2)/1e8).toFixed(8),(Math.ceil(inputTotal/2)/1e8).toFixed(8)], output_amounts,
      geo_country: ['US','DE','SG','GB','NL','IN','JP'][i%7], asn: String(64512+i%12) };
    rows.push(row);
    if (i%3 === 0) rows.push({ ...row, timestamp: new Date(date.getTime()+850).toISOString(), src_ip: `203.0.113.${1+i%48}` });
  }
  return rows;
}

function serialize(rows, format) {
  if (format === 'json') return JSON.stringify(rows,null,2);
  const keys = Object.keys(rows[0]);
  if (format === 'csv') {
    const cell = value => `"${(Array.isArray(value) ? JSON.stringify(value) : String(value)).replaceAll('"','""')}"`;
    return [keys.join(','), ...rows.map(row=>keys.map(key=>cell(row[key])).join(','))].join('\r\n');
  }
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<records>\n'+rows.map(row=>'  <record>\n'+keys.map(key=>`    <${key}>${Array.isArray(row[key]) ? row[key].map(value=>`<item>${escape(value)}</item>`).join('') : escape(row[key])}</${key}>`).join('\n')+'\n  </record>').join('\n')+'\n</records>';
}
module.exports = { demoRows, serialize };
