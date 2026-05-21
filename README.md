# Tracking Audit Tool

A manual-drive tracking audit tool for CRO and analytics work. Open a site in a real browser, walk the funnel as you normally would, click Finish, and the tool produces a full inventory of what fired across every analytics and ad platform plus an editable Word report ready for the client.

## What it captures

- Every network request, with vendor identification across GA4, GTM, Google Ads, Floodlight, Meta, TikTok, LinkedIn, Microsoft UET (Bing), Snapchat, Pinterest, Reddit, X, Criteo, Hotjar, Microsoft Clarity, FullStory, HubSpot, Klaviyo, Adobe Analytics, Segment, Mixpanel, Amplitude
- Every dataLayer push, captured before any tag fires by hooking `dataLayer.push` at document_start
- CMS / platform detected (Shopify, Magento, WooCommerce, BigCommerce, Salesforce Commerce Cloud, Wix, Squarespace, Webflow, Shopware, PrestaShop, WordPress, Drupal)
- GTM container IDs and GA4 measurement IDs
- The funnel of URLs visited
- Custom dimensions and parameters per event with samples

## Prerequisites

- macOS (works on Linux and Windows too)
- Node.js 18 or newer. Check with `node -v`. If missing, install from https://nodejs.org or via Homebrew: `brew install node`

## Install

In the terminal, navigate to the project folder and run:

```bash
npm install
```

This installs Playwright and the `docx` library. The postinstall step also downloads the Chromium binary Playwright needs (around 150MB). First install can take a minute or two.

## Run

```bash
node audit.js <url> [--mode=ecommerce|leadgen]
```

Examples:

```bash
node audit.js https://example.com --mode=ecommerce
node audit.js https://example.com --mode=leadgen
```

Chromium opens. Drive the funnel: browse the homepage, view a product or service, add to cart or fill the form, go through checkout to the thank-you page. When you have walked the journey, click the dark blue **Finish Audit** button in the top right of the page.

The tool then analyses what was captured and writes the report. Output appears in `./output/<hostname>-<timestamp>/`.

## Output files

Each audit produces a folder with seven files.

**For internal control (open in Sheets):**

- `raw_requests.csv` every network request including ones from non-tracking vendors. Useful when you need to debug what was happening at a specific moment
- `datalayer.csv` every dataLayer push with full payload as JSON
- `events.csv` parsed tracking events with full params, one row per event
- `events_summary.csv` pivot-style view of platform, event, fire count, unique pages. Open this first for a quick read
- `parameters.csv` per platform and event, every parameter that fired, sample values, and a classification column flagging GA4 custom dimensions (event-scoped string, event-scoped number, user property string, user property number)

**For the deliverable:**

- `audit_report.docx` editable Word document with executive summary, opportunities table, coverage check, stack detected, events by platform, parameters and custom dimensions, dataLayer events, funnel and detailed issue tables
- `audit.json` machine-readable summary that feeds the docx and can be archived or fed into other tools

## Modes

Two modes change which events the tool expects to find.

**ecommerce** (default): expects `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, `purchase`. Recommended set includes `view_item_list`, `select_item`, `view_cart`, `add_to_wishlist`, `remove_from_cart`, `add_shipping_info`, `add_payment_info`, `view_promotion`, `select_promotion`, `refund`.

**leadgen**: expects `page_view`, `generate_lead`, `form_submit`. Recommended set includes `sign_up`, `login`, `view_search_results`, `file_download`, `video_start`, `video_complete`, `cta_click`.

Edit `config/expected-events.js` to adjust the lists or add a new mode.

## What the analysis covers

- **Coverage check** which critical and recommended events are missing for the chosen mode
- **Duplicate detection** flags events firing twice within 2 seconds on the same page, or two events sharing the same transaction_id, both common causes of inflated metrics
- **Parameter completeness** flags GA4 conversion events missing `transaction_id`, `value` or `currency`
- **Conversion presence** flags Meta and TikTok pixels active without conversion events fired
- **Score** out of 100 based on stack completeness, critical event coverage, duplicates and parameter quality

## Extending the tool

**Add a new vendor**: append to the `VENDORS` array in `config/vendors.js` with a name and URL match function. Then add a case in the `extractEvent` switch in `lib/parse.js` if the vendor uses a non-standard event field.

**Adjust expected events**: edit `config/expected-events.js`.

**Add a CMS detection**: add a branch in `lib/detect.js` inside `detectStack`.

## Troubleshooting

**"Cannot find module 'playwright'"** run `npm install` again.

**Chromium does not open** run `npx playwright install chromium` manually.

**"Browser was launched but page is blank"** the site may block headless-like browsers. The tool runs in non-headless mode so this is rare, but check ad blockers or VPNs first.

**Finish button does not appear** some sites with strict CSP may block injected styling. The button is still in the DOM, just not visible. You can run `window.__auditFinish()` in DevTools console as a fallback.

**Cookie banner blocks the journey** accept or dismiss the banner as a real user would. The tool captures consent state from GA4 `gcs` and `gcd` parameters automatically.

**Single page application has loose navigation** the tool listens to `framenavigated` which captures pushState transitions on most SPAs. If a site uses fragment routing only, funnel capture will be limited.

## Notes

This is v1. Known limitations:

- The DOCX uses a clean default style. Brand styling (logos, colours, fonts) is not yet applied
- Server-side tagging endpoints (custom subdomains forwarding to GA4 or Meta) are not auto-detected. Add the domain pattern to `config/vendors.js` when needed
- Consent Mode v2 signals (`gcs`, `gcd`, `dma`) are captured in the raw event params but not yet surfaced as a dedicated section in the report

Next planned step is wrapping this in an Electron app so non-technical colleagues can use it without the terminal.
