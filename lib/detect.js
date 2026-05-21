// Detects the tech stack on the page: CMS, marketing tools and container IDs.

async function detectStack(page) {
  return await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((s) => s.src).filter(Boolean);
    const out = {
      cms: null,
      tools: [],
      gtmIds: [],
      ga4Ids: [],
    };

    // CMS / platform detection
    if (window.Shopify) out.cms = 'Shopify';
    else if (window.BCData || /\/mage\//.test(scripts.join(' ')) || document.body.classList.contains('cms-index-index')) out.cms = 'Magento';
    else if (window.woocommerce_params || document.querySelector('link[href*="woocommerce"]') || /generator.*WooCommerce/i.test(document.head.innerHTML)) out.cms = 'WooCommerce';
    else if (window.wp || /generator.*WordPress/i.test(document.head.innerHTML) || document.querySelector('link[href*="wp-content"]')) out.cms = 'WordPress';
    else if (scripts.some((s) => /cdn11\.bigcommerce\.com/.test(s))) out.cms = 'BigCommerce';
    else if (window.SitePreferences || document.documentElement.dataset.action) out.cms = 'Salesforce Commerce Cloud';
    else if (scripts.some((s) => /wixstatic/.test(s)) || document.documentElement.classList.contains('wix-iframe')) out.cms = 'Wix';
    else if (window.Static && window.Static.SQUARESPACE_CONTEXT) out.cms = 'Squarespace';
    else if (window.Webflow) out.cms = 'Webflow';
    else if (window.Drupal) out.cms = 'Drupal';
    else if (/generator.*Shopware/i.test(document.head.innerHTML)) out.cms = 'Shopware';
    else if (/generator.*PrestaShop/i.test(document.head.innerHTML)) out.cms = 'PrestaShop';

    // Tools detection by globals and loaded scripts
    const has = (name) => typeof window[name] !== 'undefined';
    const scriptMatch = (rx) => scripts.some((s) => rx.test(s));

    if (has('gtag') || scriptMatch(/googletagmanager\.com\/gtag/)) out.tools.push('GA4');
    if (has('google_tag_manager') || scriptMatch(/googletagmanager\.com\/gtm/)) out.tools.push('GTM');
    if (has('fbq')) out.tools.push('Meta');
    if (has('ttq')) out.tools.push('TikTok');
    if (has('_linkedin_data_partner_ids') || has('_linkedin_partner_id')) out.tools.push('LinkedIn');
    if (has('uetq') || scriptMatch(/bat\.bing\.com/)) out.tools.push('Microsoft UET');
    if (has('snaptr')) out.tools.push('Snapchat');
    if (has('pintrk')) out.tools.push('Pinterest');
    if (has('rdt')) out.tools.push('Reddit');
    if (has('twq')) out.tools.push('X (Twitter)');
    if (has('criteo_q')) out.tools.push('Criteo');
    if (has('hj') || scriptMatch(/static\.hotjar\.com/)) out.tools.push('Hotjar');
    if (has('clarity') || scriptMatch(/clarity\.ms/)) out.tools.push('Microsoft Clarity');
    if (has('FS') || has('_fs_loaded')) out.tools.push('FullStory');
    if (has('_hsq') || scriptMatch(/js\.hs-scripts\.com/)) out.tools.push('HubSpot');
    if (has('_learnq') || scriptMatch(/klaviyo/)) out.tools.push('Klaviyo');
    if (has('_satellite') || has('s_account')) out.tools.push('Adobe Analytics');
    if (window.analytics && typeof window.analytics.initialize === 'function') out.tools.push('Segment');
    if (has('mixpanel')) out.tools.push('Mixpanel');
    if (has('amplitude')) out.tools.push('Amplitude');

    // GTM container IDs and GA4 measurement IDs from script srcs
    for (const s of scripts) {
      const gtm = s.match(/[?&]id=(GTM-[A-Z0-9]+)/);
      if (gtm && !out.gtmIds.includes(gtm[1])) out.gtmIds.push(gtm[1]);
      const ga = s.match(/[?&]id=(G-[A-Z0-9]+)/);
      if (ga && !out.ga4Ids.includes(ga[1])) out.ga4Ids.push(ga[1]);
    }

    return out;
  });
}

module.exports = { detectStack };
