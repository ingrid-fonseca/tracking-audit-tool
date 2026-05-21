// Vendor detection by URL pattern. Order matters where patterns overlap.

const VENDORS = [
  // Google ecosystem
  { name: 'GA4', match: (u) => /\/g\/collect/.test(u) || /\/g\/s\/collect/.test(u) },
  { name: 'Universal Analytics', match: (u) => /google-analytics\.com\/(r\/)?collect/.test(u) && !/\/g\/collect/.test(u) },
  { name: 'GTM', match: (u) => /googletagmanager\.com\/(gtm|gtag)/.test(u) },
  { name: 'Google Ads', match: (u) => /googleadservices\.com\/pagead\/conversion/.test(u) || /googleads\.g\.doubleclick\.net/.test(u) || /\/ccm\/collect/.test(u) },
  { name: 'Floodlight', match: (u) => /fls\.doubleclick\.net/.test(u) || /\bad\.doubleclick\.net\//.test(u) },

  // Social and ad platforms
  { name: 'Meta', match: (u) => /facebook\.com\/tr/.test(u) || /connect\.facebook\.net/.test(u) },
  { name: 'TikTok', match: (u) => /analytics\.tiktok\.com/.test(u) || /business-api\.tiktok\.com/.test(u) },
  { name: 'LinkedIn', match: (u) => /px\.ads\.linkedin\.com/.test(u) || /snap\.licdn\.com\/li\.lms-analytics/.test(u) },
  { name: 'Microsoft UET', match: (u) => /bat\.bing\.com/.test(u) },
  { name: 'Snapchat', match: (u) => /tr\.snapchat\.com/.test(u) || /sc-static\.net\/scevent/.test(u) },
  { name: 'Pinterest', match: (u) => /ct\.pinterest\.com/.test(u) || /s\.pinimg\.com\/ct/.test(u) },
  { name: 'Reddit', match: (u) => /events\.redditmedia\.com/.test(u) || /alb\.reddit\.com/.test(u) },
  { name: 'X (Twitter)', match: (u) => /analytics\.twitter\.com/.test(u) || /static\.ads-twitter\.com/.test(u) || /ads-twitter\.com\/uwt/.test(u) },
  { name: 'Criteo', match: (u) => /\.criteo\.(com|net)/.test(u) },

  // Analytics, UX, CRM
  { name: 'Hotjar', match: (u) => /\.hotjar\.com/.test(u) || /static\.hotjar\.com/.test(u) },
  { name: 'Microsoft Clarity', match: (u) => /clarity\.ms/.test(u) },
  { name: 'FullStory', match: (u) => /fullstory\.com/.test(u) },
  { name: 'HubSpot', match: (u) => /\.hubspot\.com/.test(u) || /\.hs-analytics\.net/.test(u) || /__ptq\.gif/.test(u) || /js\.hs-scripts\.com/.test(u) },
  { name: 'Klaviyo', match: (u) => /a\.klaviyo\.com/.test(u) || /static\.klaviyo\.com/.test(u) },
  { name: 'Adobe Analytics', match: (u) => /\.sc\.omtrdc\.net/.test(u) || /\.2o7\.net/.test(u) },
  { name: 'Segment', match: (u) => /api\.segment\.io/.test(u) || /cdn\.segment\.com/.test(u) },
  { name: 'Mixpanel', match: (u) => /api(-js)?\.mixpanel\.com/.test(u) || /cdn\.mxpnl\.com/.test(u) },
  { name: 'Amplitude', match: (u) => /api2?\.amplitude\.com/.test(u) },
];

function identify(url) {
  for (const v of VENDORS) {
    if (v.match(url)) return v.name;
  }
  return null;
}

module.exports = { VENDORS, identify };
