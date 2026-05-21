// Writes all output files: CSVs for internal control, JSON for archival,
// DOCX as the editable client deliverable.

const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  TableLayoutType,
  HeadingLevel,
  WidthType,
  ShadingType,
  AlignmentType,
  BorderStyle,
} = require('docx');

// Strip XML 1.0 illegal characters and cap length. Real tracking data is
// full of control bytes (0x01, 0x02 etc) that make docx files unopenable in
// Word and Google Docs because document.xml fails validation.
function safe(input, maxLen = 1500) {
  if (input === null || input === undefined) return '';
  let s = String(input);
  // Remove control chars except tab (0x09), LF (0x0A), CR (0x0D)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Remove non-characters and replacement char (binary decode artefacts)
  s = s.replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
  // Remove unpaired surrogates
  s = s.replace(/[\uD800-\uDFFF]/g, '');
  // Cap to a sensible length, longer strings would just bloat the doc
  if (s.length > maxLen) s = s.slice(0, maxLen) + '...';
  return s;
}

// Total usable page width in DXA (twentieths of a point) for portrait A4
// with default 1" margins. Used as the basis for table column widths.
const PAGE_WIDTH_DXA = 9000;

// Standard column-width presets keyed by column count. Tables without these
// collapse to single-character width when content is long.
const COL_WIDTHS = {
  2: [3500, 5500],
  3: [1800, 3500, 3700],
  4: [2200, 2200, 1400, 3200],
};

// ----------- CSV helpers -----------

function escapeCSV(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCSV(filepath, rows) {
  if (rows.length === 0) {
    fs.writeFileSync(filepath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCSV(r[h])).join(',')),
  ];
  fs.writeFileSync(filepath, lines.join('\n'));
}

function writeRawCSV(outdir, requests) {
  const rows = requests.map((r) => ({
    timestamp: r.timestamp,
    method: r.method,
    url: r.url,
    resource_type: r.resourceType,
    post_data: r.postData,
  }));
  writeCSV(path.join(outdir, 'raw_requests.csv'), rows);
}

function writeDataLayerCSV(outdir, dataLayer) {
  const rows = dataLayer.map((d) => ({
    timestamp: d.timestamp,
    page: d.url || '',
    event: (d.payload && d.payload.event) || '',
    payload: JSON.stringify(d.payload || {}),
  }));
  writeCSV(path.join(outdir, 'datalayer.csv'), rows);
}

function writeEventsCSV(outdir, events) {
  const rows = events.map((e) => ({
    timestamp: e.timestamp,
    platform: e.platform,
    event: e.event,
    page: e.page,
    referrer: e.referrer,
    params: JSON.stringify(e.params || {}),
  }));
  writeCSV(path.join(outdir, 'events.csv'), rows);
}

function writeSummaryCSV(outdir, eventsByPlatform) {
  const rows = [];
  for (const [platform, evs] of Object.entries(eventsByPlatform)) {
    for (const [event, data] of Object.entries(evs)) {
      rows.push({
        platform,
        event,
        fire_count: data.count,
        unique_pages: data.pages.size,
        pages_sample: Array.from(data.pages).slice(0, 3).join(' | '),
      });
    }
  }
  // Sort by platform then count desc
  rows.sort((a, b) => a.platform.localeCompare(b.platform) || b.fire_count - a.fire_count);
  writeCSV(path.join(outdir, 'events_summary.csv'), rows);
}

function writeParametersCSV(outdir, paramsByEvent) {
  const rows = [];
  for (const [key, params] of Object.entries(paramsByEvent)) {
    const [platform, event] = key.split('|');
    for (const [paramName, data] of Object.entries(params)) {
      rows.push({
        platform,
        event,
        parameter: paramName,
        classification: data.classification,
        fill_count: data.count,
        sample_values: Array.from(data.samples).join(' | '),
      });
    }
  }
  rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.event.localeCompare(b.event) || a.parameter.localeCompare(b.parameter));
  writeCSV(path.join(outdir, 'parameters.csv'), rows);
}

// ----------- JSON -----------

function writeJSON(outdir, audit) {
  const json = {
    url: audit.url,
    mode: audit.mode,
    timestamp: audit.timestamp,
    score: audit.score,
    stack: audit.stack,
    funnel: audit.funnel,
    expected: audit.expected,
    missing: audit.missing,
    eventsByPlatform: Object.fromEntries(
      Object.entries(audit.eventsByPlatform).map(([k, v]) => [
        k,
        Object.fromEntries(
          Object.entries(v).map(([ek, ev]) => [
            ek,
            { count: ev.count, unique_pages: ev.pages.size },
          ])
        ),
      ])
    ),
    duplicates: audit.duplicates,
    paramIssues: audit.paramIssues,
    opportunities: audit.opportunities,
  };
  fs.writeFileSync(path.join(outdir, 'audit.json'), JSON.stringify(json, null, 2));
}

// ----------- DOCX helpers -----------

const NAVY = '0B1F3A';
const GOLD = 'C9A24B';
const GREY_BG = 'F4F4F4';
const WHITE = 'FFFFFF';

function cell(text, { bold = false, header = false } = {}) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: safe(text),
            bold: bold || header,
            color: header ? WHITE : '111111',
          }),
        ],
      }),
    ],
    shading: header
      ? { type: ShadingType.SOLID, color: NAVY, fill: NAVY }
      : undefined,
  });
}

function tableRow(cells) {
  return new TableRow({ children: cells });
}

// Table that fills the page width with proportional columns. Without explicit
// columnWidths plus FIXED layout, Word collapses columns based on content,
// which made every table in v1.1 render unreadable.
function fullWidthTable(rows, columnCount) {
  const widths = COL_WIDTHS[columnCount] || Array(columnCount).fill(Math.floor(PAGE_WIDTH_DXA / columnCount));
  return new Table({
    rows,
    width: { size: PAGE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
  });
}

function heading(text, level) {
  return new Paragraph({ text: safe(text, 200), heading: level });
}

function kvParagraph(label, value) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${safe(label, 100)}: `, bold: true }),
      new TextRun(safe(value)),
    ],
  });
}

function spacer() {
  return new Paragraph('');
}

// ----------- DOCX builder -----------

async function writeDocx(outdir, audit) {
  const children = [];

  // Title block
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Tracking Audit Report', bold: true, size: 44, color: NAVY })],
    })
  );
  children.push(spacer());

  children.push(kvParagraph('URL', audit.url));
  children.push(kvParagraph('Mode', audit.mode));
  children.push(kvParagraph('Audit date', audit.timestamp));
  children.push(kvParagraph('Score', `${audit.score}/100`));
  children.push(spacer());

  // Executive summary
  children.push(heading('Executive summary', HeadingLevel.HEADING_2));
  children.push(new Paragraph(safe(buildSummaryText(audit))));
  children.push(spacer());

  // Opportunities (top of doc on purpose)
  children.push(heading('Opportunities and recommendations', HeadingLevel.HEADING_2));
  if (audit.opportunities.length === 0) {
    children.push(new Paragraph('No issues detected.'));
  } else {
    const rows = [
      tableRow([cell('Severity', { header: true }), cell('Issue', { header: true }), cell('Impact', { header: true })]),
      ...audit.opportunities.map((o) =>
        tableRow([cell(o.severity), cell(o.issue), cell(o.impact)])
      ),
    ];
    children.push(fullWidthTable(rows, 3));
  }
  children.push(spacer());

  // Coverage table (status-style summary, matches the user's CSV example)
  children.push(heading('Coverage check', HeadingLevel.HEADING_2));
  const coverageRows = buildCoverageRows(audit);
  children.push(
    fullWidthTable([
      tableRow([cell('Area', { header: true }), cell('Status', { header: true }), cell('Recommendation', { header: true })]),
      ...coverageRows.map((r) => tableRow([cell(r.area), cell(r.status), cell(r.recommendation)])),
    ], 3)
  );
  children.push(spacer());

  // Stack detected
  children.push(heading('Stack detected', HeadingLevel.HEADING_2));
  children.push(kvParagraph('CMS / platform', audit.stack.cms || 'Not detected'));
  children.push(kvParagraph('GTM containers', audit.stack.gtmIds.join(', ') || 'None'));
  children.push(kvParagraph('GA4 properties', audit.stack.ga4Ids.join(', ') || 'None'));
  children.push(kvParagraph('Tools detected', audit.stack.tools.join(', ') || 'None'));
  children.push(spacer());

  // Event coverage detail
  children.push(heading('Event coverage detail', HeadingLevel.HEADING_2));
  children.push(kvParagraph('Critical events expected', audit.expected.critical.join(', ')));
  children.push(kvParagraph('Missing critical', audit.missing.critical.join(', ') || 'None'));
  children.push(kvParagraph('Recommended expected', audit.expected.recommended.join(', ')));
  children.push(kvParagraph('Missing recommended', audit.missing.recommended.join(', ') || 'None'));
  children.push(spacer());

  // Events by platform
  children.push(heading('Events by platform', HeadingLevel.HEADING_2));
  if (Object.keys(audit.eventsByPlatform).length === 0) {
    children.push(new Paragraph('No tracked events captured.'));
  } else {
    for (const [platform, evs] of Object.entries(audit.eventsByPlatform)) {
      children.push(heading(platform, HeadingLevel.HEADING_3));
      const rows = [
        tableRow([cell('Event', { header: true }), cell('Fire count', { header: true }), cell('Unique pages', { header: true })]),
        ...Object.entries(evs)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([event, data]) =>
            tableRow([cell(event), cell(String(data.count)), cell(String(data.pages.size))])
          ),
      ];
      children.push(fullWidthTable(rows, 3));
      children.push(spacer());
    }
  }

  // Parameters and custom dimensions. Skip session-only vendors where bodies
  // are binary and params aren't meaningful for an audit.
  const SKIP_PARAM_DETAIL = new Set(['Microsoft Clarity', 'Hotjar', 'FullStory']);
  children.push(heading('Parameters and custom dimensions', HeadingLevel.HEADING_2));
  const paramEntries = Object.entries(audit.paramsByEvent).filter(([key]) => {
    const platform = key.split('|')[0];
    return !SKIP_PARAM_DETAIL.has(platform);
  });
  if (paramEntries.length === 0) {
    children.push(new Paragraph('No parameters captured.'));
  } else {
    for (const [key, params] of paramEntries) {
      const [platform, event] = key.split('|');
      children.push(heading(`${platform} - ${event}`, HeadingLevel.HEADING_3));
      const rows = [
        tableRow([
          cell('Parameter', { header: true }),
          cell('Type', { header: true }),
          cell('Fill count', { header: true }),
          cell('Sample values', { header: true }),
        ]),
        ...Object.entries(params)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([paramName, data]) =>
            tableRow([
              cell(paramName),
              cell(data.classification),
              cell(String(data.count)),
              cell(Array.from(data.samples).join(' | ').slice(0, 220)),
            ])
          ),
      ];
      children.push(fullWidthTable(rows, 4));
      children.push(spacer());
    }
  }

  // DataLayer events seen
  children.push(heading('DataLayer events', HeadingLevel.HEADING_2));
  const dlByEvent = {};
  for (const d of audit.dataLayer) {
    const ev = d.payload && d.payload.event;
    if (!ev) continue;
    if (!dlByEvent[ev]) dlByEvent[ev] = 0;
    dlByEvent[ev]++;
  }
  const dlEntries = Object.entries(dlByEvent).sort((a, b) => b[1] - a[1]);
  if (dlEntries.length === 0) {
    children.push(new Paragraph('No dataLayer events captured.'));
  } else {
    const rows = [
      tableRow([cell('Event', { header: true }), cell('Push count', { header: true })]),
      ...dlEntries.map(([ev, n]) => tableRow([cell(ev), cell(String(n))])),
    ];
    children.push(fullWidthTable(rows, 2));
  }
  children.push(spacer());

  // Funnel
  children.push(heading('Funnel captured', HeadingLevel.HEADING_2));
  if (audit.funnel.length === 0) {
    children.push(new Paragraph('No navigation recorded.'));
  } else {
    for (const url of audit.funnel) {
      children.push(new Paragraph(`• ${safe(url, 500)}`));
    }
  }

  // Duplicates and param issues detail
  if (audit.duplicates.length > 0) {
    children.push(spacer());
    children.push(heading('Potential duplicates', HeadingLevel.HEADING_2));
    const rows = [
      tableRow([cell('Platform', { header: true }), cell('Event', { header: true }), cell('Basis', { header: true }), cell('Page', { header: true })]),
      ...audit.duplicates.map((d) => tableRow([cell(d.platform), cell(d.event), cell(d.basis), cell(d.page || '')])),
    ];
    children.push(fullWidthTable(rows, 4));
  }

  if (audit.paramIssues.length > 0) {
    children.push(spacer());
    children.push(heading('Parameter issues', HeadingLevel.HEADING_2));
    const rows = [
      tableRow([cell('Event', { header: true }), cell('Issue', { header: true }), cell('Page', { header: true })]),
      ...audit.paramIssues.map((p) => tableRow([cell(p.event), cell(p.issue), cell(p.page || '')])),
    ];
    children.push(fullWidthTable(rows, 3));
  }

  const doc = new Document({
    creator: 'Tracking Audit Tool',
    title: 'Tracking Audit Report',
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(outdir, 'audit_report.docx'), buffer);
}

function buildSummaryText(audit) {
  const parts = [];
  parts.push(`Audit of ${audit.url} run in ${audit.mode} mode.`);
  parts.push(`Score: ${audit.score}/100.`);
  if (audit.stack.cms) parts.push(`Platform detected: ${audit.stack.cms}.`);
  parts.push(`Marketing tools detected: ${audit.stack.tools.join(', ') || 'none'}.`);
  parts.push(`Network events captured: ${audit.events.length} across ${Object.keys(audit.eventsByPlatform).length} platform(s).`);
  parts.push(`DataLayer pushes: ${audit.dataLayer.length}.`);
  if (audit.missing.critical.length > 0) {
    parts.push(`Missing critical events: ${audit.missing.critical.join(', ')}.`);
  } else {
    parts.push('All critical events present.');
  }
  return parts.join(' ');
}

function buildCoverageRows(audit) {
  const rows = [];
  const hasGA4 = audit.stack.tools.includes('GA4') || !!audit.eventsByPlatform.GA4;
  const hasAdPixel = ['Meta', 'TikTok', 'LinkedIn', 'Microsoft UET', 'Pinterest', 'Snapchat', 'Reddit', 'X (Twitter)']
    .some((t) => audit.stack.tools.includes(t));
  const hasSessionTool = ['Hotjar', 'Microsoft Clarity', 'FullStory'].some((t) => audit.stack.tools.includes(t));
  const ga4 = audit.eventsByPlatform.GA4 || {};
  const hasConv = audit.mode === 'ecommerce' ? !!ga4.purchase : (!!ga4.generate_lead || !!ga4.form_submit);

  rows.push({
    area: 'Tracking foundation',
    status: hasGA4 ? 'In place' : 'Missing',
    recommendation: hasGA4 ? 'GA4 detected on site' : 'Install GA4 via GTM as the analytics foundation',
  });

  rows.push({
    area: 'Conversion tracking',
    status: hasConv ? 'In place' : 'Missing',
    recommendation: hasConv
      ? 'Conversion events firing into GA4'
      : (audit.mode === 'ecommerce'
        ? 'Implement purchase event with transaction_id, value, currency and items'
        : 'Implement generate_lead or form_submit on lead capture points'),
  });

  rows.push({
    area: 'Ad platform pixels',
    status: hasAdPixel ? 'In place' : 'Missing',
    recommendation: hasAdPixel
      ? `Detected: ${audit.stack.tools.filter((t) => ['Meta', 'TikTok', 'LinkedIn', 'Microsoft UET', 'Pinterest', 'Snapchat', 'Reddit', 'X (Twitter)'].includes(t)).join(', ')}`
      : 'Install Meta, TikTok or LinkedIn pixels depending on paid media mix',
  });

  rows.push({
    area: 'Session insight',
    status: hasSessionTool ? 'In place' : 'Missing',
    recommendation: hasSessionTool
      ? 'Heatmap or session recording tool detected'
      : 'Install Hotjar or Microsoft Clarity for qualitative behavioural insight',
  });

  rows.push({
    area: 'Optimisation readiness',
    status: hasGA4 && hasConv && hasAdPixel ? 'Ready' : 'Not ready',
    recommendation: hasGA4 && hasConv && hasAdPixel
      ? 'Conversion signals available for ad platform optimisation'
      : 'Close gaps above before relying on platform optimisation',
  });

  return rows;
}

module.exports = {
  writeRawCSV,
  writeDataLayerCSV,
  writeEventsCSV,
  writeSummaryCSV,
  writeParametersCSV,
  writeJSON,
  writeDocx,
};