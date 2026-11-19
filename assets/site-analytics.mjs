const token = 'phc_ndUFGAMCyQhx3ynmTfMnvWwXb3U4PrvsHz5jCiXcknZ4';
const endpoint = 'https://eu.i.posthog.com/i/v0/e/';
const siteHost = 'altqnotes.app';
const preferenceKey = 'altq-website-analytics-v1';
const sessionKey = 'altq-website-session-v1';
const qaKey = 'altq-website-qa';
const campaigns = {
  'geeknews/referral/save-notes-images-tabs': 'geeknews',
  'medium/referral/save-notes-images-tabs': 'medium',
  'dev/referral/save-notes-images-tabs': 'dev',
};

function entryCategory(params, referrer) {
  const inbound = [params.get('utm_source'), params.get('utm_medium'), params.get('utm_campaign')].join('/');
  if (Object.hasOwn(campaigns, inbound)) return campaigns[inbound];
  if (!referrer) return 'direct';
  try {
    const host = new URL(referrer).hostname;
    if (host === siteHost) return 'internal';
    if (host === 'www.google.com' || host === 'www.google.co.kr') return 'google';
    if (host === 'www.bing.com') return 'bing';
  } catch {
    return 'unknown';
  }
  return 'other_referral';
}

function storageGet(storage, key) {
  try {
    return window[storage].getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value === null) window[storage].removeItem(key);
    else window[storage].setItem(key, value);
  } catch {
    // Keep the choice for the current page when storage is unavailable.
  }
}

const params = new URLSearchParams(location.search);
const inbound = [params.get('utm_source'), params.get('utm_medium'), params.get('utm_campaign')].join('/');
const articleChannel = Object.hasOwn(campaigns, inbound) ? campaigns[inbound] : null;
const isTest = params.get('analytics_test') === '1' || storageGet('sessionStorage', qaKey) === '1';
const trafficSource = entryCategory(params, document.referrer);
const placements = new Map();

for (const link of document.querySelectorAll('a[data-store-placement]')) {
  const placement = link.dataset.storePlacement;
  if (placement !== 'header' && placement !== 'hero') continue;
  let campaign = 'homepage_' + placement;
  if (isTest) campaign = 'qa_homepage_' + placement;
  else if (articleChannel) campaign = 'homepage_' + articleChannel + '_save_notes_images_tabs_' + placement;
  const url = new URL(link.href);
  url.searchParams.set('utm_campaign', campaign);
  link.href = url.href;
  placements.set(link, { placement, storeCampaign: campaign });
}

if (location.protocol === 'https:' && location.hostname === siteHost) {
  const notice = document.querySelector('#analytics-notice');
  const preferences = document.querySelector('#analytics-preferences');
  const allow = document.querySelector('#analytics-allow');
  const decline = document.querySelector('#analytics-decline');
  let choice = storageGet('localStorage', preferenceKey);
  let sessionId;
  let viewedSession;

  function capture(event, detail) {
    if (choice !== 'allow') return;
    if (!sessionId) {
      sessionId = storageGet('sessionStorage', sessionKey);
      if (!/^web:(public|qa):[0-9a-f-]{36}$/.test(sessionId || '') ||
          !sessionId.startsWith(isTest ? 'web:qa:' : 'web:public:')) {
        sessionId = (isTest ? 'web:qa:' : 'web:public:') + crypto.randomUUID();
        storageSet('sessionStorage', sessionKey, sessionId);
      }
      if (isTest) storageSet('sessionStorage', qaKey, '1');
    }
    if (event === 'website_page_view') {
      if (viewedSession === sessionId) return;
      viewedSession = sessionId;
    }
    const payload = {
      api_key: token,
      event,
      distinct_id: sessionId,
      properties: {
        appEnvironment: isTest ? 'development' : 'production',
        trafficType: isTest ? 'qa' : 'public',
        surface: 'website',
        page: 'homepage',
        trafficSource,
        $process_person_profile: false,
        $geoip_disable: true,
        ...detail,
      },
    };
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {});
  }

  function choose(next) {
    choice = next;
    storageSet('localStorage', preferenceKey, next);
    if (next === 'allow') capture('website_page_view');
    else {
      sessionId = undefined;
      storageSet('sessionStorage', sessionKey, null);
    }
    notice.hidden = true;
    preferences.focus({ preventScroll: true });
  }

  preferences.hidden = false;
  notice.hidden = choice === 'allow' || choice === 'decline';
  preferences.addEventListener('click', () => {
    notice.hidden = false;
    (choice === 'allow' ? decline : allow).focus();
  });
  allow.addEventListener('click', () => choose('allow'));
  decline.addEventListener('click', () => choose('decline'));
  window.addEventListener('storage', (event) => {
      if (event.key === preferenceKey || event.key === null) {
      choice = storageGet('localStorage', preferenceKey);
      if (choice !== 'allow') {
        sessionId = undefined;
        storageSet('sessionStorage', sessionKey, null);
      }
    }
  });
  if (choice === 'allow') capture('website_page_view');

  for (const [link, detail] of placements) {
    function storeClick(event) {
      if (event.defaultPrevented) return;
      if (event.type === 'auxclick' && event.button !== 1) return;
      if (choice !== 'allow') return;
      capture('website_page_view');
      capture('store_cta_clicked', detail);
    }
    link.addEventListener('click', storeClick);
    link.addEventListener('auxclick', storeClick);
  }
}
