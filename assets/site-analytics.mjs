const token = 'phc_ndUFGAMCyQhx3ynmTfMnvWwXb3U4PrvsHz5jCiXcknZ4';
const endpoint = 'https://eu.i.posthog.com/i/v0/e/';
const siteHost = 'altqnotes.app';
const articlePages = new Set(['save-notes-images-tabs', 'research-tabs-with-notes', 'sync-chrome-notes-google-drive']);
const path = location.pathname.replace(/(?:\/index\.html|\/)$/, '');
const articleSlug = path.startsWith('/blog/') ? path.slice('/blog/'.length) : null;
const article = articlePages.has(articleSlug) ? articleSlug : null;
const preferenceKey = article ? 'altq-blog-analytics-v1' : 'altq-website-analytics-v1';
const sessionKey = article ? 'altq-blog-session-v1' : 'altq-website-session-v1';
const qaKey = 'altq-website-qa';
const articleSessionMs = 60 * 60 * 1000;
const llmSources = new Map([
  ['chatgpt.com', 'chatgpt'], ['www.chatgpt.com', 'chatgpt'],
  ['chat.openai.com', 'chatgpt'], ['chatgpt', 'chatgpt'],
  ['perplexity.ai', 'perplexity'], ['www.perplexity.ai', 'perplexity'], ['perplexity', 'perplexity'],
  ['gemini.google.com', 'gemini'], ['gemini', 'gemini'],
  ['copilot.microsoft.com', 'copilot'], ['copilot', 'copilot'],
  ['claude.ai', 'claude'], ['www.claude.ai', 'claude'], ['claude', 'claude'],
]);
const llmCategories = new Set(llmSources.values());
const articleCategories = new Set([...llmCategories, 'geeknews', 'medium', 'dev', 'direct', 'internal', 'google', 'bing', 'unknown', 'other_referral']);
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

function articleSource(params, referrer) {
  const tagged = llmSources.get(params.get('utm_source')?.trim().toLowerCase());
  if (tagged) return tagged;
  if (referrer) {
    try {
      const referred = llmSources.get(new URL(referrer).hostname);
      if (referred) return referred;
    } catch {
      return 'unknown';
    }
  }
  return entryCategory(params, referrer);
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
const trafficSource = article ? articleSource(params, document.referrer) : entryCategory(params, document.referrer);
const sessionPrefix = isTest ? 'web:qa:' : 'web:public:';
const viewEvent = article ? 'article_page_view' : 'website_page_view';
const clickEvent = article ? 'article_store_cta_clicked' : 'store_cta_clicked';
const placements = new Map();

for (const link of document.querySelectorAll('a[data-store-placement]')) {
  const placement = link.dataset.storePlacement;
  if (placement !== 'header' && placement !== (article ? 'article' : 'hero')) continue;
  const url = new URL(link.href);
  let campaign = url.searchParams.get('utm_campaign');
  if (article) {
    if (campaign !== 'article_' + article.replaceAll('-', '_')) continue;
    if (isTest) campaign = 'qa_' + campaign;
  } else {
    campaign = 'homepage_' + placement;
    if (isTest) campaign = 'qa_homepage_' + placement;
    else if (articleChannel) campaign = 'homepage_' + articleChannel + '_save_notes_images_tabs_' + placement;
  }
  url.searchParams.set('utm_campaign', campaign);
  link.href = url.href;
  placements.set(link, { placement, storeCampaign: campaign });
}

if (location.protocol === 'https:' && location.hostname === siteHost && (article || path === '')) {
  const notice = document.querySelector('#analytics-notice');
  const preferences = document.querySelector('#analytics-preferences');
  const allow = document.querySelector('#analytics-allow');
  const decline = document.querySelector('#analytics-decline');
  let choice = storageGet('localStorage', preferenceKey);
  let sessionId;
  let articleSession;
  let viewedSession;

  function validSessionId(id) {
    return typeof id === 'string' && /^web:(public|qa):[0-9a-f-]{36}$/.test(id) && id.startsWith(sessionPrefix);
  }

  function articleVisit() {
    let visit = articleSession;
    if (!visit) {
      try { visit = JSON.parse(storageGet('sessionStorage', sessionKey) || 'null'); } catch { /* Invalid stored session. */ }
    }
    const now = Date.now();
    if (!validSessionId(visit?.id) || !articleCategories.has(visit.source) ||
        !articlePages.has(visit.entryPage) || !(visit.expiresAt > now && visit.expiresAt <= now + articleSessionMs) ||
        (llmCategories.has(trafficSource) && visit.source !== trafficSource)) {
      visit = { id: sessionPrefix + crypto.randomUUID(), source: trafficSource, entryPage: article, expiresAt: now + articleSessionMs };
      storageSet('sessionStorage', sessionKey, JSON.stringify(visit));
    }
    articleSession = visit;
    return visit;
  }

  function capture(event, detail) {
    if (choice !== 'allow') return;
    const visit = article ? articleVisit() : null;
    if (visit) sessionId = visit.id;
    else if (!sessionId) {
      sessionId = storageGet('sessionStorage', sessionKey);
      if (!validSessionId(sessionId)) {
        sessionId = sessionPrefix + crypto.randomUUID();
        storageSet('sessionStorage', sessionKey, sessionId);
      }
    }
    if (isTest) storageSet('sessionStorage', qaKey, '1');
    if (event === viewEvent) {
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
        page: article || 'homepage',
        trafficSource: visit?.source ?? trafficSource,
        ...(visit ? { entryPage: visit.entryPage, isLlmReferral: llmCategories.has(visit.source) } : {}),
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
    if (next === 'allow') capture(viewEvent);
    else {
      sessionId = undefined;
      articleSession = undefined;
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
        articleSession = undefined;
        storageSet('sessionStorage', sessionKey, null);
      }
    }
  });
  if (choice === 'allow') capture(viewEvent);

  for (const [link, detail] of placements) {
    function storeClick(event) {
      if (event.defaultPrevented) return;
      if (event.type === 'auxclick' && event.button !== 1) return;
      if (choice !== 'allow') return;
      capture(viewEvent);
      capture(clickEvent, detail);
    }
    link.addEventListener('click', storeClick);
    link.addEventListener('auxclick', storeClick);
  }
}
