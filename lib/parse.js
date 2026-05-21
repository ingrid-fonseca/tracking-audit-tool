// Parses request bodies and queries, normalises events per vendor.

function parseQuery(url) {
  try {
    return Object.fromEntries(new URL(url).searchParams.entries());
  } catch {
    return {};
  }
}

function parseFormBody(body) {
  const obj = {};
  body.split('&').forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf('=');
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? '' : pair.slice(idx + 1);
    try {
      obj[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
    } catch {
      obj[k] = v;
    }
  });
  return obj;
}

function parseBody(body) {
  if (!body) return {};
  // Detect binary content. Session-recording tools (Clarity, Hotjar, FullStory)
  // and some ad-platform endpoints send protobuf or other binary payloads.
  // Trying to parse them as form data produces garbage keys with control chars.
  if (isBinaryLike(body)) return {};
  // Try JSON
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  // Fall back to form encoding
  try {
    return parseFormBody(body);
  } catch {
    return {};
  }
}

// Heuristic: more than 5% non-text chars suggests binary. Replacement chars
// (0xFFFD) are a giveaway that Playwright's utf8 decode of the raw body failed.
function isBinaryLike(s) {
  if (!s || s.length < 4) return false;
  let weird = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (
      c === 0xFFFD ||
      (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) ||
      (c >= 0xE000 && c <= 0xF8FF) // private use
    ) {
      weird++;
    }
  }
  return weird / s.length > 0.05;
}

// GA4 batched requests send multiple events in the body, separated by newlines.
// Each line is its own form-encoded payload that should be merged with the
// shared query string.
function parseGA4(req) {
  const query = parseQuery(req.url);
  if (!req.postData) return [{ ...query }];

  const lines = req.postData.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [{ ...query }];

  return lines.map((line) => ({ ...query, ...parseFormBody(line) }));
}

function extractEvent(vendor, params) {
  switch (vendor) {
    case 'GA4':
      return params.en || params.event_name || 'page_view';
    case 'Meta':
      return params.ev || params.event_name || 'unknown';
    case 'TikTok':
      return params.event || 'unknown';
    case 'LinkedIn':
      return params.conversionId ? `conversion_${params.conversionId}` : 'insight';
    case 'Microsoft UET':
      return params.evt || 'pageLoad';
    case 'Pinterest':
      return params.event || 'unknown';
    case 'Snapchat':
      return params.event_type || 'unknown';
    case 'Google Ads':
      return 'conversion';
    case 'Floodlight':
      return params.type || params.cat || 'floodlight';
    case 'X (Twitter)':
      return params.events ? 'conversion' : 'pixel';
    case 'Reddit':
      return params.event_type || params.event || 'unknown';
    case 'HubSpot':
      return 'track';
    case 'Microsoft Clarity':
      return 'session';
    case 'Hotjar':
      return 'session';
    case 'FullStory':
      return 'session';
    case 'Adobe Analytics':
      return 'page_view';
    case 'Klaviyo':
      return params.event || 'track';
    default:
      return 'request';
  }
}

function extractPage(params) {
  return params.dl || params.url || params.page_url || params.page || '';
}

function extractReferrer(params) {
  return params.dr || params.referrer || '';
}

// Identifies whether a GA4 parameter is a custom dimension and what scope.
function classifyGA4Param(name) {
  if (name.startsWith('ep.')) return 'custom dim (event, string)';
  if (name.startsWith('epn.')) return 'custom dim (event, number)';
  if (name.startsWith('up.')) return 'user property (string)';
  if (name.startsWith('upn.')) return 'user property (number)';
  return 'standard';
}

module.exports = {
  parseQuery,
  parseBody,
  parseGA4,
  extractEvent,
  extractPage,
  extractReferrer,
  classifyGA4Param,
};