# Shopping Quality Analyzer

A Chrome extension that analyzes product quality on Myntra and Amazon India using Google Gemini AI. Get instant material analysis, price-value assessment, brand reputation, and a buy/skip recommendation — all without leaving the product page.

## Demo - https://www.youtube.com/watch?v=neG48zj1WUI

## Features

- **Material Analysis** — grades the fabric/material (A–F), scores durability and comfort, lists pros and cons
- **Price & Value** — verdict of Good Value / Fair Price / Overpriced with reasoning
- **Buy Recommendation** — BUY NOW / WAIT FOR SALE / SKIP with confidence level
- **Brand Reputation** — tier classification (Luxury → Value/Budget) with context
- **MRP Inflation Warning** — flags artificially inflated "original prices" used to fake discounts
- **Better Alternatives** — suggests superior materials and their price impact
- **Fit & Care** — sizing notes for apparel, plain-English care tips
- **Results Cache** — caches analysis for 24 hours so repeat visits are instant
- **Buyer Preferences** — personalize analysis by material preference, skin type, budget focus, and sustainability

## Supported Sites

| Site | URL Pattern |
|------|-------------|
| Myntra | `myntra.com/<category>/<product-id>` |
| Amazon India | `amazon.in/dp/<ASIN>` |

## Setup

### 1. Get a Gemini API Key

Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and create a free API key. The free tier is sufficient for personal use.

### 2. Install the Extension

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `myntra-quality-analyzer` folder

### 3. Add Your API Key

**Option A — config file (recommended for developers):**

Edit `config.js` and paste your key:

```js
window.GEMINI_KEY = 'AIzaSy...';
```

**Option B — in-extension setup:**

Leave `config.js` unchanged. On first open, the extension will show a key input field. Paste your key there and click **Save & Continue**. The key is stored in Chrome's local storage.

> **Security note:** Keep `config.js` private. It is listed in `.gitignore` and should never be committed.

## Usage

1. Navigate to any Myntra or Amazon India product page
2. Click the **Shopping Quality Analyzer** icon in the Chrome toolbar
3. The extension reads the product details from the page
4. Click **Analyze Quality** to run the AI analysis
5. Results appear with material grade, price verdict, recommendation, and alternatives

**Refresh:** If you want a fresh analysis (bypassing the 24-hour cache), click the **🔄 Refresh** button that appears alongside the "Cached X ago" label.

**Preferences:** Click the ⚙ icon in the header to set your buyer profile — this tailors the AI analysis to your specific needs.

## Project Structure

```
myntra-quality-analyzer/
├── manifest.json          # Chrome extension manifest (MV3)
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic: tab detection, Gemini calls, rendering
├── styles.css             # Popup styles
├── config.js              # API key (gitignored — do not commit)
├── sites/
│   ├── myntra.js          # Myntra product scraper (injected content script)
│   └── amazon.js          # Amazon India product scraper (injected content script)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **Detection** — when the popup opens, `chrome.tabs.query` identifies the active browser tab
2. **Scraping** — `chrome.scripting.executeScript` injects the site-specific scraper (an IIFE) into the page; it reads the DOM and returns structured product data
3. **Analysis** — the product data is sent to the Gemini API with a structured prompt; the response is constrained to a specific JSON schema
4. **Rendering** — the JSON response is rendered into the popup UI; results are cached in `chrome.storage.local` for 24 hours

The extension tries Gemini models in order (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`) and falls back automatically if a model is overloaded.

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Read the URL and inject scrapers into the current tab |
| `scripting` | Execute the product scraper in the page context |
| `storage` | Persist the API key, buyer preferences, and analysis cache |

Host permissions are granted for `myntra.com`, `amazon.in`, and the Gemini API endpoint.

## Limitations

- Only works on product detail pages (not search/listing pages)
- Analysis quality depends on how much product information is available on the page — sparse listings produce generic results
- Gemini free-tier rate limits may occasionally cause a brief delay; the extension retries automatically across models
- Amazon India page structure changes occasionally; if scraping fails, try reloading the product page and reopening the extension
