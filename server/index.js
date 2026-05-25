const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const { Parser } = require("json2csv");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/test", (req, res) => res.json({ status: "OK" }));

app.post("/scrape", async (req, res) => {
  const { query } = req.body;
  const limit = parseInt(req.body.limit, 10) || 20;
  console.log("\n=== SCRAPE REQUEST:", query, "limit:", limit, "===");
  if (!query) return res.status(400).json({ message: "Query is required" });

  let browser;
  try {
    const executablePath = await puppeteer.executablePath();
    browser = await puppeteer.launch({
      headless: false,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
        "--lang=en-US,en",
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log("Navigating to:", mapsUrl);
    await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));

    // Handle consent popup
    try {
      for (const sel of ['#L2AGLb', 'button[aria-label*="Accept"]', 'form:nth-child(2) button']) {
        const btn = await page.$(sel);
        if (btn) { await btn.click(); await new Promise((r) => setTimeout(r, 2000)); break; }
      }
    } catch (_) {}

    await page.screenshot({ path: "debug-screenshot.png" });
    console.log("Current URL:", page.url());

    // Check for feed or single result
    let isFeed = false;
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
      isFeed = true;
      console.log("Feed found ✓");
    } catch (_) {
      console.log("No feed — checking single result...");
    }

    if (!isFeed) {
      const hasSingleResult = await page.$("h1");
      if (hasSingleResult) {
        const data = await scrapePlacePage(page);
        await browser.close();
        return res.json({ results: data.name ? [data] : [] });
      }
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 300));
      console.log("Page preview:", pageText);
      await browser.close();
      return res.status(500).json({ message: "Could not find results. Check debug-screenshot.png" });
    }

    await new Promise((r) => setTimeout(r, 2000));
    const scrollableDiv = await page.$('div[role="feed"]');
    if (scrollableDiv) {
      for (let i = 0; i < 8; i++) {
        await page.evaluate((el) => el.scrollBy(0, 1000), scrollableDiv);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    const links = await page.$$eval('a[href*="/place/"]', (els) =>
      [...new Set(els.map((el) => el.href))]
    );
    console.log(`Found ${links.length} place links`);

    const results = [];
    for (const link of links.slice(0, limit)) {
      try {
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20000 });
        await new Promise((r) => setTimeout(r, 3000));
        const data = await scrapePlacePage(page);
        if (data.name) {
          results.push(data);
          console.log("✓ Scraped:", data.name);
        }
      } catch (err) {
        console.log("  ✗ Error:", err.message);
      }
    }

    await browser.close();
    browser = null;
    console.log(`\n=== DONE: ${results.length} results ===\n`);
    res.json({ results });

  } catch (error) {
    console.error("\n=== ERROR ===\n", error.message, "\n", error.stack);
    if (browser) try { await browser.close(); } catch (_) {}
    res.status(500).json({ message: "Scraping failed: " + error.message });
  }
});

async function scrapePlacePage(page) {
  return page.evaluate(() => {
    const name = document.querySelector("h1")?.innerText?.trim() || "";
    const ratingEl = document.querySelector('div[role="img"][aria-label]');
    const rating = ratingEl?.getAttribute("aria-label") || "";
    const category = document.querySelector(".DkEaL")?.innerText?.trim() || "";

    let address = "", phone = "", website = "", email = "";

    const addressEl = document.querySelector('[data-item-id="address"] .Io6YTe');
    if (addressEl) address = addressEl.innerText.trim();

    const phoneEl = document.querySelector('[data-item-id^="phone"] .Io6YTe');
    if (phoneEl) phone = phoneEl.innerText.trim();

    const websiteEl = document.querySelector('[data-item-id="authority"] .Io6YTe');
    if (websiteEl) website = websiteEl.innerText.trim();

    // Try to find email in page text
    const bodyText = document.body.innerText;
    const emailMatch = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) email = emailMatch[0];

    // Also check all anchor mailto links
    const mailtoLink = document.querySelector('a[href^="mailto:"]');
    if (mailtoLink) email = mailtoLink.href.replace("mailto:", "").split("?")[0];

    // Fallback: scan buttons
    if (!address || !phone || !website) {
      Array.from(document.querySelectorAll("button")).forEach((btn) => {
        const text = btn.innerText?.trim() || "";
        if (!address && (text.includes("India") || text.includes("Rajasthan") || /\d{6}/.test(text)))
          address = text;
        if (!phone && /(\+91|0)?[6-9]\d{9}/.test(text))
          phone = text.match(/(\+91[\s-]?)?[6-9]\d{9}/)?.[0] || text;
        if (!website && (text.includes(".com") || text.includes(".in") || text.includes(".org")))
          website = text;
      });
    }

    // Extract lat/lng from URL
    let lat = "", lng = "";
    const urlMatch = window.location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (urlMatch) { lat = urlMatch[1]; lng = urlMatch[2]; }

    const reviewsEl = document.querySelector('span[aria-label*="review"]');
    const reviews = reviewsEl?.getAttribute("aria-label") || "";

    return { name, rating, reviews, category, address, phone, email, website, lat, lng };
  });
}

app.post("/download-csv", (req, res) => {
  const { results } = req.body;
  try {
    const fields = ["name", "rating", "reviews", "category", "address", "phone", "email", "website"];
    const json2csv = new Parser({ fields });
    const csv = json2csv.parse(results);
    res.header("Content-Type", "text/csv");
    res.attachment("companies.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).json({ message: "CSV generation failed" });
  }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));