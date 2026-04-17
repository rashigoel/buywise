'use strict';

// ── Site Registry ──────────────────────────────────────────────────────────────

const SITES = {
  'myntra.com': {
    name: 'Myntra',
    productPattern: /myntra\.com\/[^?#]*\/\d{5,}/,
    scraperFile: 'sites/myntra.js',
    currency: '₹',
    locale: 'en-IN',
  },
  'amazon.in': {
    name: 'Amazon India',
    productPattern: /amazon\.in\/(?:.*\/)?dp\//i,
    scraperFile: 'sites/amazon.js',
    currency: '₹',
    locale: 'en-IN',
  },
};

function detectSite(url) {
  for (const [domain, config] of Object.entries(SITES)) {
    if (url.includes(domain)) return { domain, ...config };
  }
  return null;
}

// ── Gemini API ─────────────────────────────────────────────────────────────────

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

async function callGemini(key, product, prefs) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt(product, prefs) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.4,
            maxOutputTokens: 3072,
          },
        }),
      });

      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        const msg = e.error?.message || `Gemini API error ${resp.status}`;
        const isOverloaded = resp.status === 429 || resp.status === 503
          || msg.toLowerCase().includes('high demand')
          || msg.toLowerCase().includes('overloaded');
        if (isOverloaded) { lastErr = new Error(msg); continue; }
        throw new Error(msg);
      }

      const data = await resp.json();
      if (data.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('Response blocked by Gemini safety filters');
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      return JSON.parse(text);
    } catch (err) {
      const isOverloaded = err.message?.toLowerCase().includes('high demand')
        || err.message?.toLowerCase().includes('overloaded');
      if (isOverloaded) { lastErr = err; continue; }
      throw err;
    }
  }
  throw lastErr || new Error('All Gemini models are currently unavailable');
}

function buildPrompt(p, prefs) {
  const price = p.price
    ? `${p.currency}${Number(p.price).toLocaleString(p.locale || 'en-IN')}`
    : 'unknown';
  const mrpPart = p.mrp
    ? ` (MRP ${p.currency}${Number(p.mrp).toLocaleString(p.locale || 'en-IN')}, ${p.discount || '?'}% off)`
    : '';

  const profileCtx = prefsToPromptContext(prefs);

  return `You are an expert product quality analyst for the Indian e-commerce market.

Analyze this ${p.siteName} product and return quality insights:

Product: ${p.title || 'Unknown'}
Brand: ${p.brand || 'Unknown'}
Category: ${p.category || 'consumer product'}
Price: ${price}${mrpPart}
Fabric/Material: ${p.material || 'Not specified — please infer from category and product type'}
Customer Rating: ${p.rating ? `${p.rating}/5` : 'N/A'}${p.reviewCount ? ` (${p.reviewCount} reviews)` : ''}
Description: ${p.description?.slice(0, 300) || 'N/A'}
${profileCtx}
Return ONLY a valid JSON object — no markdown, no explanation outside the JSON:
{
  "productSummary": "One-sentence description",
  "mrpInflationWarning": null,
  "brandReputation": {
    "tier": "Mid-range",
    "note": "Short brand reputation note"
  },
  "materialAnalysis": {
    "name": "Primary material name (infer if not specified)",
    "score": 7,
    "grade": "B+",
    "pros": ["benefit 1", "benefit 2", "benefit 3"],
    "cons": ["drawback 1", "drawback 2"],
    "durability": "High",
    "comfort": "Medium",
    "maintenanceLevel": "Easy"
  },
  "fitAdvice": null,
  "careInstructions": ["Care tip 1", "Care tip 2"],
  "priceAnalysis": {
    "verdict": "Good Value",
    "score": 7,
    "reasoning": "2-sentence explanation",
    "priceCategory": "Mid-range"
  },
  "buyTiming": {
    "bestTime": "End of Season Sale",
    "reasoning": "Brief reasoning"
  },
  "qualityVsStandards": {
    "rating": "Average",
    "comparison": "How it compares to industry norms for this product type",
    "isGoodForPurpose": true
  },
  "betterAlternatives": [
    { "material": "Name", "benefit": "Specific advantage", "priceImpact": "Similar/10–30% higher/30%+ higher" },
    { "material": "Name", "benefit": "Specific advantage", "priceImpact": "Similar/10–30% higher/30%+ higher" }
  ],
  "recommendation": {
    "verdict": "BUY NOW",
    "confidence": "High",
    "reasoning": "2–3 sentences with clear rationale",
    "bestFor": "Ideal buyer or use case"
  },
  "keyInsight": "One actionable tip for Indian buyers about this product type"
}

Constraints:
- verdict: "BUY NOW" | "WAIT FOR SALE" | "SKIP"
- durability/comfort: "High" | "Medium" | "Low"
- maintenanceLevel: "Easy" | "Moderate" | "Demanding"
- priceAnalysis.verdict: "Good Value" | "Fair Price" | "Overpriced"
- qualityVsStandards.rating: "Above Average" | "Average" | "Below Average"
- brandReputation.tier: "Luxury" | "Premium" | "Mid-range" | "Fast Fashion" | "Value/Budget"
- mrpInflationWarning: null if MRP looks genuine; warning string if discount appears artificially inflated
- fitAdvice: null for non-apparel; for apparel a concise fit/sizing note e.g. "Runs small — size up"
- careInstructions: 2–4 short plain-English care tips (empty array [] if not applicable)
- buyTiming.bestTime: short phrase like "Now" | "End of Season Sale (June/Dec)" | "Festival sale (Oct/Nov)"`;
}

// ── Analysis Cache ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX    = 50;
const CACHE_STORE  = 'analysisCache';

function cacheKey(url) {
  try { return new URL(url).pathname; } catch { return url || ''; }
}

function _getCache() {
  return new Promise(r =>
    chrome.storage.local.get(CACHE_STORE, d => r(d[CACHE_STORE] || {}))
  );
}

function _setCache(cache) {
  return new Promise(r => chrome.storage.local.set({ [CACHE_STORE]: cache }, r));
}

async function cacheGet(key) {
  if (!key) return null;
  const cache = await _getCache();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete cache[key];
    await _setCache(cache);
    return null;
  }
  return entry;
}

async function cacheSet(key, analysis) {
  if (!key) return;
  const cache = await _getCache();
  cache[key] = { ts: Date.now(), analysis };
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    const oldest = keys.sort((a, b) => cache[a].ts - cache[b].ts).slice(0, keys.length - CACHE_MAX);
    oldest.forEach(k => delete cache[k]);
  }
  await _setCache(cache);
}

async function cacheDelete(key) {
  if (!key) return;
  const cache = await _getCache();
  delete cache[key];
  await _setCache(cache);
}

function formatCacheAge(ts) {
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// ── Preferences ────────────────────────────────────────────────────────────────

const PREFS_STORE   = 'userPrefs';
const DEFAULT_PREFS = { material: 'no-preference', skin: 'normal', budget: 'value', sustainability: false };

function getPrefs() {
  return new Promise(r =>
    chrome.storage.local.get(PREFS_STORE, d =>
      r({ ...DEFAULT_PREFS, ...(d[PREFS_STORE] || {}) })
    )
  );
}

function savePrefs(prefs) {
  return new Promise(r => chrome.storage.local.set({ [PREFS_STORE]: prefs }, r));
}

function prefsToPromptContext(p) {
  if (!p) return '';
  const lines = [];
  if (p.material !== 'no-preference') {
    lines.push(`- Material preference: ${p.material === 'natural' ? 'prefers natural/organic fibers' : 'synthetics are acceptable'}`);
  }
  if (p.skin === 'sensitive') lines.push('- Skin type: sensitive (flag materials that may cause irritation)');
  if (p.budget) lines.push(`- Budget focus: ${p.budget}`);
  if (p.sustainability) lines.push('- Prioritizes eco-friendly/sustainable materials');
  return lines.length ? `\nBuyer Profile:\n${lines.join('\n')}\n` : '';
}

// ── State ──────────────────────────────────────────────────────────────────────

let currentProduct  = null;
let currentSite     = null;
let currentTabUrl   = '';
let currentAnalysis = null;
let userPrefs       = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('saveApiKeyBtn').addEventListener('click', handleSaveKey);
  document.getElementById('analyzeBtn').addEventListener('click', handleAnalyze);
  document.getElementById('settingsBtn').addEventListener('click', handleSettings);
  document.getElementById('retryBtn').addEventListener('click', init);
  document.getElementById('reanalyzeBtn').addEventListener('click', () => {
    currentProduct ? showProduct(currentProduct) : init();
  });
  document.getElementById('apiKeyInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSaveKey();
  });

  // Settings view
  document.getElementById('savePrefsBtn').addEventListener('click', handleSavePrefs);
  document.getElementById('settingsApiKeyBtn').addEventListener('click', () => showView('apiKeyView'));
  document.getElementById('settingsBackBtn').addEventListener('click', () => {
    currentProduct ? showProduct(currentProduct) : init();
  });

  // Results actions
  document.getElementById('refreshBtn').addEventListener('click', handleForceAnalyze);
  document.getElementById('findSimilarBtn').addEventListener('click', handleFindSimilar);
  document.getElementById('shareBtn').addEventListener('click', handleShare);

  init().catch(err => showErrorView('Startup error: ' + (err.message || err)));
});

async function init() {
  userPrefs = await getPrefs();
  const key = await getKey();
  if (!key) { showView('apiKeyView'); return; }
  await detectProduct();
}

// ── Storage (key) ──────────────────────────────────────────────────────────────

function getKey() {
  if (typeof window.GEMINI_KEY === 'string' && window.GEMINI_KEY.length > 10) {
    return Promise.resolve(window.GEMINI_KEY);
  }
  return new Promise(r => chrome.storage.local.get('geminiKey', d => r(d.geminiKey || null)));
}

function saveKey(key) {
  return new Promise(r => chrome.storage.local.set({ geminiKey: key }, r));
}

async function handleSaveKey() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  if (!key) return;
  if (key.length < 20) {
    setInlineError('Key looks too short — paste the full Gemini API key');
    return;
  }
  await saveKey(key);
  input.value = '';
  clearInlineError();
  await detectProduct();
}

async function handleSettings() {
  userPrefs = await getPrefs();
  document.getElementById('prefMaterial').value         = userPrefs.material;
  document.getElementById('prefSkin').value             = userPrefs.skin;
  document.getElementById('prefBudget').value           = userPrefs.budget;
  document.getElementById('prefSustainability').checked = !!userPrefs.sustainability;
  showView('settingsView');
}

async function handleSavePrefs() {
  userPrefs = {
    material:       document.getElementById('prefMaterial').value,
    skin:           document.getElementById('prefSkin').value,
    budget:         document.getElementById('prefBudget').value,
    sustainability: document.getElementById('prefSustainability').checked,
  };
  await savePrefs(userPrefs);
  currentProduct ? showProduct(currentProduct) : init();
}

// ── Page Detection ─────────────────────────────────────────────────────────────

async function detectProduct() {
  try {
    // windowType:'normal' excludes the popup window itself, which gains focus
    // when opened and would otherwise be returned by currentWindow/lastFocusedWindow
    const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
    const tab = tabs[0];
    if (!tab?.id) { showView('notProductView'); return; }

    const url = tab.url || '';
    currentTabUrl = url;

    const site = detectSite(url);
    if (!site) { showView('notProductView'); return; }
    if (!site.productPattern.test(url)) { showView('notProductView'); return; }

    currentSite = site;
    showView('loadingView');
    setText('loadingText', `Reading ${site.name} product…`);

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [site.scraperFile],
    });
    const product = result?.result;
    if (!product || (!product.title && !product.brand)) {
      showView('notProductView'); return;
    }
    currentProduct = product;
    showProduct(product);
  } catch (err) {
    showErrorView(`Could not read page: ${err.message || 'unknown error'}`);
  }
}

// ── Render Product Card ────────────────────────────────────────────────────────

function showProduct(p) {
  const site = currentSite;
  const siteBadge = document.getElementById('siteBadge');
  if (siteBadge) siteBadge.textContent = p.siteName || '';

  setText('productBrand', p.brand || 'Unknown Brand');
  setText('productName', p.title || 'Unknown Product');

  if (p.price) {
    setText('productPrice', (p.currency || '₹') + Number(p.price).toLocaleString(site?.locale || 'en-IN'));
  }

  const discEl = document.getElementById('productDiscount');
  if (p.discount && discEl) {
    discEl.textContent = p.discount + '% off';
    discEl.classList.remove('hidden');
  } else if (discEl) {
    discEl.classList.add('hidden');
  }

  setText('productMaterial', p.material ? 'Material: ' + p.material : 'Material: Not specified');

  if (p.rating) {
    const rv = p.reviewCount
      ? ` (${Number(p.reviewCount).toLocaleString(site?.locale || 'en-IN')} reviews)`
      : '';
    setText('productRating', p.rating + '★' + rv);
  } else {
    setText('productRating', '');
  }

  showView('productView');
}

// ── Analysis ───────────────────────────────────────────────────────────────────

async function handleAnalyze() {
  const key = await getKey();
  if (!key) { showView('apiKeyView'); return; }

  const ck = cacheKey(currentTabUrl);
  const hit = await cacheGet(ck);
  if (hit) {
    currentAnalysis = hit.analysis;
    renderResults(hit.analysis);
    showCacheIndicator(hit.ts);
    showView('resultsView');
    return;
  }

  await runAnalysis(ck);
}

async function handleForceAnalyze() {
  const ck = cacheKey(currentTabUrl);
  await cacheDelete(ck);
  await runAnalysis(ck);
}

async function runAnalysis(ck) {
  const key = await getKey();
  if (!key) { showView('apiKeyView'); return; }

  showView('loadingView');
  setText('loadingText', 'Analyzing quality with Gemini…');

  try {
    const analysis = await callGemini(key, currentProduct, userPrefs);
    currentAnalysis = analysis;
    await cacheSet(ck, analysis);
    renderResults(analysis);
    hideCacheIndicator();
    showView('resultsView');
  } catch (err) {
    showErrorView('Analysis failed: ' + (err.message || 'unknown error'));
  }
}

function showCacheIndicator(ts) {
  const el = document.getElementById('cacheIndicator');
  if (!el) return;
  el.textContent = `Cached ${formatCacheAge(ts)}`;
  el.classList.remove('hidden');
  document.getElementById('refreshBtn')?.classList.remove('hidden');
}

function hideCacheIndicator() {
  document.getElementById('cacheIndicator')?.classList.add('hidden');
  document.getElementById('refreshBtn')?.classList.add('hidden');
}

// ── Action Handlers ────────────────────────────────────────────────────────────

function handleFindSimilar() {
  const p = currentProduct;
  if (!p) return;
  const q = encodeURIComponent(`${p.brand || ''} ${p.category || ''} similar`.trim());
  chrome.tabs.create({ url: `https://www.google.com/search?q=${q}&tbm=shop` });
}

async function handleShare() {
  const p = currentProduct;
  const a = currentAnalysis;
  if (!p || !a) return;

  const lines = [
    `${p.brand || ''} — ${p.title || ''}`,
    `Price: ${p.currency || '₹'}${p.price || '?'}`,
    `Verdict: ${a.recommendation?.verdict || 'N/A'} (${a.recommendation?.confidence || '-'} confidence)`,
    `Material: ${a.materialAnalysis?.name || '-'} | ${a.materialAnalysis?.grade || '-'} | ${a.materialAnalysis?.score || '-'}/10`,
    `Price analysis: ${a.priceAnalysis?.verdict || '-'}`,
    a.keyInsight ? `Tip: ${a.keyInsight}` : null,
    currentTabUrl,
  ].filter(Boolean);

  const btn = document.getElementById('shareBtn');
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    btn.textContent = '✓ Copied!';
    btn.classList.add('btn-copied');
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-copied'); }, 2000);
}

// ── Render Results ─────────────────────────────────────────────────────────────

const VERDICT_CFG = {
  'BUY NOW':       { bg: '#E8F5E9', badge: '#27AE60', emoji: '✅' },
  'WAIT FOR SALE': { bg: '#FFF8E1', badge: '#F39C12', emoji: '⏳' },
  'SKIP':          { bg: '#FFEBEE', badge: '#E74C3C', emoji: '❌' },
};

const BRAND_TIER_CFG = {
  'Luxury':        { bg: '#F3E5F5', color: '#6A1B9A' },
  'Premium':       { bg: '#E3F2FD', color: '#1565C0' },
  'Mid-range':     { bg: '#E8F5E9', color: '#2E7D32' },
  'Fast Fashion':  { bg: '#FFF3E0', color: '#E65100' },
  'Value/Budget':  { bg: '#ECEFF1', color: '#455A64' },
};

function renderResults(a) {
  renderMrpWarning(a.mrpInflationWarning);
  renderRecommendation(a.recommendation, a.brandReputation);
  renderMaterial(a.materialAnalysis);
  renderFit(a.fitAdvice);
  renderCare(a.careInstructions);
  renderPrice(a.priceAnalysis);
  renderBuyTiming(a.buyTiming);
  renderStandards(a.qualityVsStandards);
  renderAlternatives(a.betterAlternatives);
  setText('keyInsight', a.keyInsight || '');
}

function renderMrpWarning(msg) {
  const el = document.getElementById('mrpWarning');
  if (!el) return;
  if (msg && typeof msg === 'string' && msg.trim()) {
    setText('mrpWarningText', msg);
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function renderRecommendation(rec, brand) {
  if (!rec) return;
  const cfg = VERDICT_CFG[rec.verdict] || VERDICT_CFG['SKIP'];
  const banner = document.getElementById('recBanner');
  const badge  = document.getElementById('recBadge');
  banner.style.background = cfg.bg;
  badge.textContent = `${cfg.emoji} ${rec.verdict}`;
  badge.style.background = cfg.badge;
  setText('recBestFor', rec.bestFor ? `Best for: ${rec.bestFor}` : '');
  setText('recReasoning', rec.reasoning || '');

  const tierRow   = document.getElementById('brandTierRow');
  const tierBadge = document.getElementById('brandTierBadge');
  const tierNote  = document.getElementById('brandTierNote');
  if (brand?.tier) {
    const tcfg = BRAND_TIER_CFG[brand.tier] || BRAND_TIER_CFG['Mid-range'];
    tierBadge.textContent = brand.tier;
    tierBadge.style.background = tcfg.bg;
    tierBadge.style.color = tcfg.color;
    if (tierNote) tierNote.textContent = brand.note || '';
    tierRow.classList.remove('hidden');
  } else {
    tierRow?.classList.add('hidden');
  }
}

function renderMaterial(ma) {
  if (!ma) return;
  const score = Number(ma.score) || 5;
  const color = score >= 8 ? '#27AE60' : score >= 6 ? '#F39C12' : '#E74C3C';
  const ring = document.getElementById('scoreRing');
  ring.style.borderColor = color;
  ring.style.color = color;
  setText('materialScore', score);
  setText('materialGrade', ma.grade || '-');
  setText('materialName', ma.name || 'Unknown');

  document.getElementById('materialAttrs').innerHTML = [
    chip(ma.durability, 'Durability'),
    chip(ma.comfort, 'Comfort'),
    chip(ma.maintenanceLevel, 'Care', true),
  ].join('');

  listItems('materialPros', ma.pros || []);
  listItems('materialCons', ma.cons || []);
}

function chip(value, label, neutral = false) {
  const cls = neutral ? 'chip-neutral'
    : value === 'High' ? 'chip-high'
    : value === 'Medium' ? 'chip-medium' : 'chip-low';
  return `<span class="attr-chip ${cls}">${label}: ${value || '–'}</span>`;
}

function renderFit(advice) {
  const card = document.getElementById('fitCard');
  if (!card) return;
  if (advice && typeof advice === 'string' && advice.trim()) {
    setText('fitText', advice);
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

function renderCare(tips) {
  const card = document.getElementById('careCard');
  if (!card) return;
  if (Array.isArray(tips) && tips.length) {
    listItems('careList', tips);
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

function renderPrice(pa) {
  if (!pa) return;
  const colors = {
    'Good Value': ['#E8F5E9', '#27AE60'],
    'Fair Price': ['#FFF8E1', '#F39C12'],
    'Overpriced': ['#FFEBEE', '#E74C3C'],
  };
  const [bg, fg] = colors[pa.verdict] || colors['Fair Price'];
  const badge = document.getElementById('priceVerdictBadge');
  Object.assign(badge.style, { background: bg, color: fg, fontWeight: '700', padding: '4px 10px', borderRadius: '6px', fontSize: '12px' });
  badge.textContent = pa.verdict || 'Fair Price';
  setText('priceCategory', pa.priceCategory || '');
  setText('priceReasoning', pa.reasoning || '');
}

function renderBuyTiming(bt) {
  const card = document.getElementById('buyTimingCard');
  if (!card) return;
  if (bt?.bestTime) {
    setText('buyTimingWhen', bt.bestTime);
    setText('buyTimingReason', bt.reasoning || '');
    card.classList.remove('hidden');
  } else {
    card.classList.add('hidden');
  }
}

function renderStandards(qs) {
  if (!qs) return;
  const colors = {
    'Above Average': ['#E8F5E9', '#27AE60'],
    'Average':       ['#FFF8E1', '#F39C12'],
    'Below Average': ['#FFEBEE', '#E74C3C'],
  };
  const [bg, fg] = colors[qs.rating] || colors['Average'];
  const badge = document.getElementById('standardsRating');
  Object.assign(badge.style, { background: bg, color: fg, fontWeight: '700', padding: '4px 10px', borderRadius: '6px', fontSize: '12px', display: 'inline-block', marginBottom: '8px' });
  badge.textContent = qs.rating || 'Average';
  setText('standardsComparison', qs.comparison || '');
}

function renderAlternatives(alts) {
  const container = document.getElementById('alternativesList');
  if (!alts?.length) {
    container.innerHTML = '<p style="font-size:12px;color:#888">No alternative data.</p>';
    return;
  }
  container.innerHTML = alts.map(a => `
    <div class="alternative">
      <div class="alt-material">${a.material || ''}</div>
      <div class="alt-benefit">↑ ${a.benefit || ''}</div>
      <div class="alt-price">Price impact: ${a.priceImpact || 'N/A'}</div>
    </div>`).join('');
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function showView(id) {
  const ALL = ['apiKeyView','settingsView','notProductView','loadingView','productView','resultsView','errorView'];
  ALL.forEach(v => document.getElementById(v)?.classList.toggle('hidden', v !== id));
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val ?? '');
}

function listItems(id, items) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = items.map(i => `<li>${i}</li>`).join('');
}

function setInlineError(msg) {
  document.getElementById('apiKeyInput').style.borderColor = '#E74C3C';
  let p = document.getElementById('inlineErr');
  if (!p) {
    p = document.createElement('p');
    p.id = 'inlineErr';
    p.style.cssText = 'color:#E74C3C;font-size:11px;margin-top:-8px;';
    document.getElementById('apiKeyInput').insertAdjacentElement('afterend', p);
  }
  p.textContent = msg;
}

function clearInlineError() {
  document.getElementById('apiKeyInput').style.borderColor = '';
  document.getElementById('inlineErr')?.remove();
}

function showErrorView(msg) {
  setText('errorMessage', msg);
  showView('errorView');
}
