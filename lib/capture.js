// Playwright capture. Opens Chromium, hooks dataLayer.push, injects a Finish
// button, records every network request and every page navigation. Returns
// raw data for the analyser to consume.

const { chromium } = require('playwright');
const { detectStack } = require('./detect');

async function capture(targetUrl) {
  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const requests = [];
  const dataLayer = [];
  const funnel = [];
  let finished = false;

  // Bridge: dataLayer pushes from the page surface to Node via exposeFunction.
  // This is the only reliable way to keep events across SPA navigations and
  // full page loads, since window state resets on each navigation.
  await context.exposeFunction('__auditCaptureDL', (entry) => {
    dataLayer.push({
      timestamp: new Date().toISOString(),
      url: entry.url,
      payload: entry.payload,
    });
  });

  await context.exposeFunction('__auditFinish', () => {
    finished = true;
  });

  // Init script runs at document_start on every page (including iframes if we
  // wanted, but we scope to top frame implicitly via location.href).
  await context.addInitScript(() => {
    // Hook dataLayer.push. Define the array if missing so we are ahead of GTM.
    window.dataLayer = window.dataLayer || [];

    const safeClone = (obj) => {
      try {
        return JSON.parse(JSON.stringify(obj, (key, value) => {
          if (typeof value === 'function') return '[Function]';
          if (value instanceof Element) return '[Element]';
          return value;
        }));
      } catch (e) {
        return { __error: 'Could not serialise', keys: Object.keys(obj || {}) };
      }
    };

    const dl = window.dataLayer;

    // Capture entries that already exist (rare but possible)
    dl.forEach((entry) => {
      try {
        window.__auditCaptureDL({ url: location.href, payload: safeClone(entry) });
      } catch (e) {}
    });

    // Wrap push
    const originalPush = dl.push.bind(dl);
    dl.push = function (...args) {
      args.forEach((entry) => {
        try {
          window.__auditCaptureDL({ url: location.href, payload: safeClone(entry) });
        } catch (e) {}
      });
      return originalPush(...args);
    };

    // Floating finish button. Re-inject if the page wipes it.
    const injectButton = () => {
      if (document.getElementById('__audit_finish')) return;
      if (!document.body) return;

      const btn = document.createElement('button');
      btn.id = '__audit_finish';
      btn.textContent = 'Finish Audit';
      btn.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'z-index:2147483647',
        'background:#0b1f3a',
        'color:#fff',
        'border:none',
        'padding:12px 18px',
        'border-radius:8px',
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'font-size:14px',
        'font-weight:600',
        'cursor:pointer',
        'box-shadow:0 4px 14px rgba(0,0,0,0.25)',
      ].join(';');
      btn.onclick = async () => {
        btn.textContent = 'Audit captured, you can close the window';
        btn.style.background = '#10b981';
        btn.disabled = true;
        try { await window.__auditFinish(); } catch (e) {}
      };
      document.body.appendChild(btn);
    };

    if (document.body) {
      injectButton();
    } else {
      document.addEventListener('DOMContentLoaded', injectButton);
    }

    // Keep button alive against SPAs that swap the DOM
    const obs = new MutationObserver(() => injectButton());
    const startObserver = () => {
      if (document.body) obs.observe(document.body, { childList: true, subtree: false });
      else setTimeout(startObserver, 100);
    };
    startObserver();
  });

  // Network capture. Skip data URIs and extension URLs.
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('chrome-extension:')) return;

    requests.push({
      timestamp: new Date().toISOString(),
      method: req.method(),
      url,
      postData: req.postData() || '',
      resourceType: req.resourceType(),
    });
  });

  // Funnel: track unique main frame URLs
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!url || url === 'about:blank') return;
    if (funnel.length === 0 || funnel[funnel.length - 1] !== url) {
      funnel.push(url);
    }
  });

  console.log('\n  Opening browser...');
  console.log('  Drive the funnel as you normally would.');
  console.log('  Click "Finish Audit" in the top right when done.\n');

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.warn(`  Initial load warning: ${e.message}`);
  }

  // Poll for finished flag. No timeout so the user can take as long as needed.
  while (!finished) {
    await new Promise((r) => setTimeout(r, 500));
    // Guard against browser being closed manually
    if (browser.contexts().length === 0 || !page.context().browser().isConnected()) {
      console.log('  Browser closed. Stopping capture.');
      break;
    }
  }

  // Detect the stack on the current page (last page user was on)
  let stack = { cms: null, tools: [], gtmIds: [], ga4Ids: [] };
  try {
    if (!page.isClosed()) {
      stack = await detectStack(page);
    }
  } catch (e) {
    console.warn(`  Stack detection skipped: ${e.message}`);
  }

  try {
    await browser.close();
  } catch (e) {}

  return { requests, dataLayer, funnel, stack };
}

module.exports = { capture };
