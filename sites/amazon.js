/**
 * Amazon India product scraper.
 * Injected via chrome.scripting.executeScript — must be a self-contained IIFE.
 */
(function scrapeAmazon() {
  const data = {
    siteName: 'Amazon India',
    title: '', brand: '', price: '', mrp: '',
    discount: '', material: '', rating: '',
    reviewCount: '', category: '', description: '',
    currency: '₹', url: window.location.href,
  };

  function getText(selector) {
    try {
      return document.querySelector(selector)?.textContent?.trim() || '';
    } catch (_) { return ''; }
  }

  function toNum(str) {
    const n = parseFloat(str.replace(/[^\d.]/g, ''));
    return isNaN(n) ? '' : String(Math.round(n));
  }

  // Title
  data.title = getText('#productTitle') ||
    getText('#title_feature_div h1') ||
    getText('h1.a-size-large');
  data.title = data.title.replace(/\s+/g, ' ').trim();

  // Brand — "Visit the [Brand] Store" link or brand row in tech spec
  const byline = getText('#bylineInfo');
  const brandMatch = byline.match(/(?:Brand:|Visit the )(.*?)(?:\s+Store|$)/i);
  if (brandMatch) {
    data.brand = brandMatch[1].trim();
  } else {
    // Try product details table
    for (const row of document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li')) {
      const text = row.textContent;
      if (/brand/i.test(text)) {
        data.brand = (text.split(/brand\s*[:\u200f]/i)[1] || '').trim().split('\n')[0].trim();
        break;
      }
    }
  }
  if (!data.brand) data.brand = getText('.po-brand .po-break-word');

  // Selling price — try multiple common selectors
  const priceSelectors = [
    '.a-price[data-a-color="base"] .a-offscreen',
    '#priceblock_ourprice',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '.priceToPay .a-offscreen',
  ];
  for (const sel of priceSelectors) {
    const t = getText(sel);
    if (t) { data.price = toNum(t); break; }
  }

  // MRP
  const mrpSelectors = [
    '.a-text-price .a-offscreen',
    '#listPrice',
    '#priceblock_listprice',
    '[data-a-strike="true"] .a-offscreen',
  ];
  for (const sel of mrpSelectors) {
    const t = getText(sel);
    if (t) { data.mrp = toNum(t); break; }
  }

  // Discount
  if (data.price && data.mrp) {
    const p = Number(data.price), m = Number(data.mrp);
    if (m > p) data.discount = String(Math.round(((m - p) / m) * 100));
  } else {
    const savingsText = getText('#savingsPercentage') || getText('[id*="saving"] .a-color-price');
    const dm = savingsText.match(/\d+/);
    if (dm) data.discount = dm[0];
  }

  // Rating (e.g. "4.3 out of 5 stars")
  const ratingText = getText('#acrPopover .a-icon-alt') ||
    getText('[data-hook="average-star-rating"] .a-icon-alt');
  const rm = ratingText.match(/[\d.]+/);
  if (rm) data.rating = rm[0];

  // Review count
  const reviewText = getText('#acrCustomerReviewText') ||
    getText('[data-hook="total-review-count"]');
  data.reviewCount = toNum(reviewText);

  // Material / Fabric — scan only targeted sections, never document.body.innerText
  const materialSections = [
    '#feature-bullets',
    '#productDetails_techSpec_section_1',
    '#productDetails_db_sections',
    '#detailBullets_feature_div',
    '#productDescription',
    '.po-fabric_type',
    '.po-material_composition',
  ].map(s => document.querySelector(s)?.textContent || '').join('\n');

  const materialPatterns = [
    /Fabric\s*[:\t ]\s*([^\n]{3,80})/i,
    /Material\s*[:\t ]\s*([^\n]{3,80})/i,
    /Material Type\s*[:\t ]\s*([^\n]{3,80})/i,
    /Composition\s*[:\t ]\s*([^\n]{3,80})/i,
    /Shell Material\s*[:\t ]\s*([^\n]{3,80})/i,
    /Sole Material\s*[:\t ]\s*([^\n]{3,80})/i,
  ];
  for (const re of materialPatterns) {
    const m = materialSections.match(re);
    if (m) { data.material = m[1].trim(); break; }
  }

  // Category from breadcrumbs
  const crumbs = [...document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, .a-breadcrumb a')];
  if (crumbs.length > 0) {
    // Take the deepest category (last breadcrumb item)
    data.category = crumbs[crumbs.length - 1].textContent.trim();
  }

  // Short feature bullet summary
  const bullets = [...document.querySelectorAll('#feature-bullets li span:not(.a-list-item)')];
  if (bullets.length) {
    data.description = bullets.map(b => b.textContent.trim()).filter(Boolean).slice(0, 5).join(' | ');
  }

  return data;
})();
