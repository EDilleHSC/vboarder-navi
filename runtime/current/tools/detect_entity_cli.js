#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const configPath = path.resolve(__dirname, '..', '..', 'NAVI', 'config', 'routing_config.json');
let entities = null;
try {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (cfg && cfg.entities) entities = cfg.entities;
} catch (e) {
  entities = null;
}

const fallback = {
  DESK: ['desk', 'billing desk', 'account', 'accounting', 'invoice', 'bill', 'receipt'],
  FINANCE: ['payment', 'due', 'amount', 'balance', 'statement', 'finance'],
  HR: ['employee', 'payroll', 'hr', 'salary', 'wage'],
  LEGAL: ['contract', 'agreement', 'nda', 'legal']
};

function scoreText(text, signals) {
  const t = text.toLowerCase();
  const matches = [];
  for (const s of signals) {
    if (t.includes(s.toLowerCase())) matches.push(s);
  }
  const confidence = signals.length>0 ? (matches.length / signals.length) : 0;
  return {confidence, matches};
}

async function main() {
  const args = process.argv.slice(2);
  let text = '';
  if (args.length > 0 && fs.existsSync(args[0])) {
    text = fs.readFileSync(args[0], 'utf8');
  } else {
    text = await new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => resolve(data));
      setTimeout(() => resolve(data), 50);
    });
  }
  if (!text) {
    console.error('No text input');
    process.exit(2);
  }
  const lookup = entities || fallback;
  const results = [];
  for (const [entity, signals] of Object.entries(lookup)) {
    const {confidence, matches} = scoreText(text, signals);
    if (confidence > 0) {
      results.push({entity, confidence, matches});
    }
  }
  results.sort((a,b) => b.confidence - a.confidence);
  const out = {detectedEntities: results};
  console.log(JSON.stringify(out));
}

main();