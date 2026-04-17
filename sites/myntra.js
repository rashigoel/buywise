/**
 * Myntra product scraper.
 * Injected via chrome.scripting.executeScript — must be a self-contained IIFE.
 * The return value is captured as InjectionResult.result.
 */
(function scrapeMyntra() {
  const data = {
    siteName: 'Myntra',
    title: '', brand: '', price: '', mrp: '',
    discount: '', material: '', rating: '',
    reviewCount: '', category: '', description: '',
    currency: '₹', url: window.location.href,
  };

  function grab(...selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        const t = el?.textContent?.trim();
        if (t) return t;
      } catch (_) {}
    }
    return '';
  }

  function toNum(str) {
    return (str.match(/[\d,]+/)?.[0] || '').replace(/,/g, '');
  }

  // Brand — Myntra renders brand as first h1 (.pdp-title)
  data.brand = grab(
    'h1.pdp-title', '.pdp-title', '[class*="pdp-title"]', '[class*="brand-name"]'
  );

  // Product name — second h1 (.pdp-name)
  data.title = grab('h1.pdp-name', '.pdp-name', '[class*="pdp-name"]');

  // Fallback: parse one or two h1s generically
  if (!data.title || !data.brand) {
    const h1s = [...document.querySelectorAll('h1')];
    if (h1s.length >= 2) {
      if (!data.brand) data.brand = h1s[0].textContent.trim();
      if (!data.title) data.title = h1s[1].textContent.trim();
    } else if (h1s.length === 1 && !data.title) {
      data.title = h1s[0].textContent.trim();
    }
  }

  // Selling price
  data.price = toNum(grab(
    '.pdp-price strong', '[class*="pdp-price"] strong',
    '[class*="selling-price"]', '[class*="discounted-price"]'
  ));

  // MRP
  const mrpEl = document.querySelector(
    '.pdp-mrp s, [class*="pdp-mrp"] s, [class*="original-price"] s, del'
  );
  if (mrpEl) data.mrp = toNum(mrpEl.textContent);

  // Discount
  data.discount = toNum(grab('[class*="pdp-discount"]', '[class*="discount-percent"]'));

  // Rating
  const ratingRaw = grab(
    '[class*="overall-rating"]', '[class*="pdp-rating-average"]'
  );
  const rm = ratingRaw.match(/[\d.]+/);
  if (rm) data.rating = rm[0];

  // Review count
  data.reviewCount = toNum(grab('[class*="review-count"]', '[class*="ratings-count"]'));

  // Material / Fabric — scan only targeted sections, never document.body.innerText
  const materialSections = [
    '[class*="pdp-product-description-content"]',
    '[class*="pdp-size-guide"]',
    '[class*="index-tableContainer"]',
    '[class*="pdp-product-description"]',
    '[class*="product-details"]',
    '[class*="spec"]',
  ].map(s => document.querySelector(s)?.textContent || '').join('\n');

  for (const re of [
    /Fabric\s*[:\t ]\s*([^\n]{3,80})/i,
    /Material\s*[:\t ]\s*([^\n]{3,80})/i,
    /Composition\s*[:\t ]\s*([^\n]{3,80})/i,
    /Made (?:of|from)\s*[:\t ]*([^\n]{3,80})/i,
  ]) {
    const m = materialSections.match(re);
    if (m) { data.material = m[1].trim(); break; }
  }

  // Category from first URL path segment
  const seg = window.location.pathname.match(/^\/([^/?#]+)/);
  if (seg) data.category = seg[1].replace(/-/g, ' ');

  // Short description
  const descEl = document.querySelector(
    '[class*="pdp-product-desc"]', '[class*="product-description"]'
  );
  if (descEl) data.description = descEl.textContent.slice(0, 400).trim();

  // JSON-LD fallback
  try {
    const ld = document.querySelector('script[type="application/ld+json"]');
    if (ld) {
      const j = JSON.parse(ld.textContent);
      if (!data.title && j.name) data.title = j.name;
      if (!data.brand && j.brand?.name) data.brand = j.brand.name;
      if (!data.price && j.offers?.price) data.price = String(j.offers.price);
      if (!data.material && j.material) data.material = j.material;
    }
  } catch (_) {}

  return data;
})();
