#!/usr/bin/env node
// Tracking audit CLI. Usage: node audit.js <url> [--mode=ecommerce|leadgen]

const fs = require('fs');
const path = require('path');
const { capture } = require('./lib/capture');
const { analyse } = require('./lib/analyse');
const {
  writeRawCSV,
  writeDataLayerCSV,
  writeEventsCSV,
  writeSummaryCSV,
  writeParametersCSV,
  writeJSON,
  writeDocx,
} = require('./lib/report');

function parseArgs() {
  const args = process.argv.slice(2);
  let url = null;
  let mode = 'ecommerce';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--mode=')) mode = a.slice(7);
    else if (a === '--mode') mode = args[++i];
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (!url) url = a;
  }

  return { url, mode };
}

function printHelp() {
  console.log(`
Tracking audit tool

Usage:
  node audit.js <url> [--mode=ecommerce|leadgen]

Examples:
  node audit.js https://example.com
  node audit.js https://example.com --mode=leadgen

Modes:
  ecommerce  expects page_view, view_item, add_to_cart, begin_checkout, purchase (default)
  leadgen    expects page_view, generate_lead, form_submit

Output is written to ./output/<hostname>-<timestamp>/
`);
}

function slugify(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]/gi, '-');
  } catch {
    return 'audit';
  }
}

(async () => {
  const { url, mode } = parseArgs();

  if (!url) {
    printHelp();
    process.exit(1);
  }

  if (!['ecommerce', 'leadgen'].includes(mode)) {
    console.error('Error: --mode must be "ecommerce" or "leadgen"');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = slugify(url);
  const outdir = path.join(process.cwd(), 'output', `${slug}-${timestamp}`);
  fs.mkdirSync(outdir, { recursive: true });

  console.log('\nTracking audit');
  console.log(`URL:    ${url}`);
  console.log(`Mode:   ${mode}`);
  console.log(`Output: ${outdir}`);

  const captured = await capture(url);

  console.log('\nCapture complete');
  console.log(`  Requests:  ${captured.requests.length}`);
  console.log(`  DataLayer: ${captured.dataLayer.length} push(es)`);
  console.log(`  Funnel:    ${captured.funnel.length} page(s)`);
  console.log(`  Stack:     ${captured.stack.cms || 'unknown CMS'}, tools: ${captured.stack.tools.join(', ') || 'none'}`);

  console.log('\nAnalysing...');
  const audit = analyse(captured, mode);
  audit.url = url;
  audit.mode = mode;
  audit.timestamp = new Date().toISOString();

  console.log('Writing reports...');
  writeRawCSV(outdir, captured.requests);
  writeDataLayerCSV(outdir, captured.dataLayer);
  writeEventsCSV(outdir, audit.events);
  writeSummaryCSV(outdir, audit.eventsByPlatform);
  writeParametersCSV(outdir, audit.paramsByEvent);
  writeJSON(outdir, audit);
  await writeDocx(outdir, audit);

  console.log(`\nDone`);
  console.log(`  Score:         ${audit.score}/100`);
  console.log(`  Opportunities: ${audit.opportunities.length}`);
  console.log(`\nFiles in ${outdir}:`);
  console.log('  raw_requests.csv');
  console.log('  datalayer.csv');
  console.log('  events.csv');
  console.log('  events_summary.csv');
  console.log('  parameters.csv');
  console.log('  audit.json');
  console.log('  audit_report.docx');
  console.log('');
})().catch((err) => {
  console.error('\nError:', err.message);
  console.error(err.stack);
  process.exit(1);
});
