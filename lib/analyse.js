// Analyses captured data into events by platform, parameter inventories,
// missing-event checks, duplicate detection and opportunities.

const EXPECTED = require('../config/expected-events');
const { identify } = require('../config/vendors');
const {
  parseQuery,
  parseBody,
  parseGA4,
  extractEvent,
  extractPage,
  extractReferrer,
  classifyGA4Param,
} = require('./parse');

function analyse(captured, mode) {
  const { requests, dataLayer, funnel, stack } = captured;
  const events = [];

  for (const req of requests) {
    const vendor = identify(req.url);
    if (!vendor) continue;

    // GA4 can batch multiple events per request, so it needs special handling
    if (vendor === 'GA4') {
      const payloads = parseGA4(req);
      for (const p of payloads) {
        events.push(buildEvent(req, vendor, p));
      }
      continue;
    }

    const query = parseQuery(req.url);
    const body = parseBody(req.postData);
    const params = { ...query, ...body };
    events.push(buildEvent(req, vendor, params));
  }

  const eventsByPlatform = aggregateEvents(events);
  const paramsByEvent = aggregateParams(events);

  // What did GA4 and dataLayer fire? Compare to expected for the mode.
  const ga4Events = new Set(Object.keys(eventsByPlatform.GA4 || {}));
  const dlEvents = new Set(
    dataLayer
      .filter((d) => d.payload && d.payload.event)
      .map((d) => d.payload.event)
  );
  const allDetected = new Set([...ga4Events, ...dlEvents]);

  const expected = EXPECTED[mode] || EXPECTED.ecommerce;
  const missing = {
    critical: expected.critical.filter((e) => !allDetected.has(e)),
    recommended: expected.recommended.filter((e) => !allDetected.has(e)),
  };

  const duplicates = findDuplicates(events);
  const paramIssues = checkParameters(events, mode);
  const opportunities = buildOpportunities({
    stack,
    eventsByPlatform,
    missing,
    duplicates,
    paramIssues,
    mode,
  });
  const score = computeScore({
    stack,
    eventsByPlatform,
    missing,
    duplicates,
    paramIssues,
    mode,
  });

  return {
    events,
    eventsByPlatform,
    paramsByEvent,
    expected,
    missing,
    duplicates,
    paramIssues,
    opportunities,
    score,
    funnel,
    stack,
    dataLayer,
  };
}

function buildEvent(req, vendor, params) {
  return {
    timestamp: req.timestamp,
    platform: vendor,
    event: extractEvent(vendor, params),
    page: extractPage(params),
    referrer: extractReferrer(params),
    params,
  };
}

function aggregateEvents(events) {
  const out = {};
  for (const e of events) {
    if (!out[e.platform]) out[e.platform] = {};
    if (!out[e.platform][e.event]) {
      out[e.platform][e.event] = { count: 0, pages: new Set(), sampleParams: {} };
    }
    out[e.platform][e.event].count++;
    if (e.page) out[e.platform][e.event].pages.add(e.page);
    // Keep first non-empty sample value per param for quick reference
    for (const [k, v] of Object.entries(e.params || {})) {
      if (out[e.platform][e.event].sampleParams[k]) continue;
      if (v !== undefined && v !== '') out[e.platform][e.event].sampleParams[k] = String(v).slice(0, 120);
    }
  }
  return out;
}

function aggregateParams(events) {
  const out = {};
  for (const e of events) {
    const key = `${e.platform}|${e.event}`;
    if (!out[key]) out[key] = {};
    for (const [pk, pv] of Object.entries(e.params || {})) {
      if (!out[key][pk]) {
        out[key][pk] = {
          count: 0,
          samples: new Set(),
          classification:
            e.platform === 'GA4' ? classifyGA4Param(pk) : 'standard',
        };
      }
      out[key][pk].count++;
      if (out[key][pk].samples.size < 3) {
        out[key][pk].samples.add(String(pv ?? '').slice(0, 120));
      }
    }
  }
  return out;
}

function findDuplicates(events) {
  // Same platform + event + page firing within 2s, or same platform + event +
  // matching transaction_id. Both indicate likely double counting.
  const dupes = [];
  const seen = new Set();
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.platform !== b.platform || a.event !== b.event) continue;

      const idA = a.params.transaction_id || a.params['ep.transaction_id'];
      const idB = b.params.transaction_id || b.params['ep.transaction_id'];
      const ta = new Date(a.timestamp).getTime();
      const tb = new Date(b.timestamp).getTime();

      let key = null;
      if (idA && idB && idA === idB) {
        key = `tx|${a.platform}|${a.event}|${idA}`;
      } else if (!idA && !idB && a.page === b.page && Math.abs(ta - tb) < 2000) {
        key = `pg|${a.platform}|${a.event}|${a.page}|${Math.floor(ta / 2000)}`;
      }

      if (key && !seen.has(key)) {
        seen.add(key);
        dupes.push({
          platform: a.platform,
          event: a.event,
          basis: idA ? `transaction_id=${idA}` : `same page within 2s`,
          page: a.page,
        });
      }
    }
  }
  return dupes;
}

function checkParameters(events) {
  const issues = [];
  for (const e of events) {
    if (e.platform !== 'GA4') continue;

    if (e.event === 'purchase') {
      const p = e.params;
      const tx = p.transaction_id || p['ep.transaction_id'];
      const value = p.value || p['ep.value'] || p['epn.value'];
      const currency = p.currency || p['ep.currency'];
      if (!tx) issues.push({ event: 'purchase', issue: 'Missing transaction_id', page: e.page });
      if (!value) issues.push({ event: 'purchase', issue: 'Missing value', page: e.page });
      if (!currency) issues.push({ event: 'purchase', issue: 'Missing currency', page: e.page });
    }

    if (e.event === 'add_to_cart' || e.event === 'begin_checkout' || e.event === 'view_item') {
      const p = e.params;
      const value = p.value || p['ep.value'] || p['epn.value'];
      if (!value) issues.push({ event: e.event, issue: 'Missing value', page: e.page });
    }

    if (e.event === 'generate_lead') {
      const p = e.params;
      const value = p.value || p['ep.value'] || p['epn.value'];
      if (!value) issues.push({ event: 'generate_lead', issue: 'Missing value (recommended for bidding)', page: e.page });
    }
  }
  return issues;
}

function buildOpportunities({ stack, eventsByPlatform, missing, duplicates, paramIssues, mode }) {
  const opps = [];

  if (!stack.tools.includes('GA4') && !eventsByPlatform.GA4) {
    opps.push({
      severity: 'HIGH',
      issue: 'No GA4 tracking detected',
      impact: 'No analytics foundation for measurement, attribution or audience building',
    });
  }

  if (missing.critical.length > 0) {
    opps.push({
      severity: 'HIGH',
      issue: `Missing critical events: ${missing.critical.join(', ')}`,
      impact: 'Tracking gap reduces attribution accuracy and ad platform optimisation',
    });
  }

  // No conversion events for this mode
  const ga4 = eventsByPlatform.GA4 || {};
  const ga4Conversion = mode === 'ecommerce'
    ? ga4.purchase
    : (ga4.generate_lead || ga4.form_submit);
  if (!ga4Conversion && Object.keys(ga4).length > 0) {
    opps.push({
      severity: 'HIGH',
      issue: 'GA4 active but no conversion events detected',
      impact: 'Google Ads and other platforms cannot optimise on real conversions',
    });
  }

  // Meta conversion check
  if (stack.tools.includes('Meta')) {
    const m = eventsByPlatform.Meta || {};
    const hasMetaConv = m.Purchase || m.Lead || m.CompleteRegistration || m.Subscribe;
    if (!hasMetaConv) {
      opps.push({
        severity: 'HIGH',
        issue: 'Meta Pixel active but no conversion events detected',
        impact: 'Meta cannot optimise campaigns or build lookalike audiences',
      });
    }
  }

  // TikTok conversion check
  if (stack.tools.includes('TikTok')) {
    const t = eventsByPlatform.TikTok || {};
    const hasTikTokConv = t.CompletePayment || t.SubmitForm || t.CompleteRegistration;
    if (!hasTikTokConv) {
      opps.push({
        severity: 'MEDIUM',
        issue: 'TikTok Pixel active but no conversion events detected',
        impact: 'TikTok cannot optimise campaigns on real outcomes',
      });
    }
  }

  if (duplicates.length > 0) {
    opps.push({
      severity: 'MEDIUM',
      issue: `${duplicates.length} potential duplicate event${duplicates.length > 1 ? 's' : ''} detected`,
      impact: 'Inflated metrics, risk of double-counted conversions',
    });
  }

  if (paramIssues.length > 0) {
    opps.push({
      severity: 'MEDIUM',
      issue: `${paramIssues.length} parameter issue${paramIssues.length > 1 ? 's' : ''} on key events`,
      impact: 'Incomplete data limits reporting accuracy and audience building',
    });
  }

  if (missing.recommended.length > 0 && missing.critical.length === 0) {
    const preview = missing.recommended.slice(0, 5).join(', ');
    opps.push({
      severity: 'LOW',
      issue: `Recommended events missing: ${preview}${missing.recommended.length > 5 ? '...' : ''}`,
      impact: 'Reduced granularity for funnel analysis and remarketing',
    });
  }

  // Stack-level observations
  if (stack.tools.length < 2) {
    opps.push({
      severity: 'LOW',
      issue: 'Limited measurement stack detected',
      impact: 'Consider adding session recording (Hotjar, Clarity) or ad pixels to widen attribution coverage',
    });
  }

  return opps;
}

function computeScore({ stack, eventsByPlatform, missing, duplicates, paramIssues, mode }) {
  let score = 100;

  if (!stack.tools.includes('GA4') && !eventsByPlatform.GA4) score -= 40;
  score -= missing.critical.length * 10;
  score -= Math.min(20, duplicates.length * 5);
  score -= Math.min(15, paramIssues.length * 3);

  const ga4 = eventsByPlatform.GA4 || {};
  const conv = mode === 'ecommerce'
    ? ga4.purchase
    : (ga4.generate_lead || ga4.form_submit);
  if (!conv) score -= 15;

  if (stack.tools.length < 2) score -= 5;

  return Math.max(0, Math.min(100, score));
}

module.exports = { analyse };
