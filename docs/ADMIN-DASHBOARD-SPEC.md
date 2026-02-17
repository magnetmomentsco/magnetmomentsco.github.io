# 🔥 Magnet Moments Command Center — Feature Spec

> **The ultimate admin dashboard that goes beyond Shopify** — things Shopify doesn't offer or charges extra for.

---

## 🏗 Architecture

| Component | Technology | Cost |
|-----------|-----------|------|
| Tracking Script | ~3KB vanilla JS on every page | Free |
| Data Storage | Firebase Realtime Database (free tier: 1GB storage, 10GB/mo bandwidth) | Free |
| Admin Dashboard | Static HTML/CSS/JS at `/admin/` | Free |
| Charts & Visualization | Chart.js (CDN) | Free |
| Password Protection | Client-side SHA-256 hashed password gate | Free |
| Data Source | Shopify Storefront API + `products.json` + GitHub API | Free |

---

## 📊 Dashboard Sections

### 1. Live Visitors Right Now
- Real-time "4 people browsing now" counter (Firebase presence)
- See which pages they're on right now
- Map of visitor locations (approximate, from timezone/locale)
- **Why it matters:** Shopify only shows this on expensive plans ($299+/mo)

### 2. Scroll Depth Analytics
- How far visitors scroll on each page (25%, 50%, 75%, 100%)
- Find out if people even SEE your CTAs or pricing
- Heatmap-style scroll depth visualization
- Per-page breakdown
- **Why it matters:** Shopify has zero scroll tracking

### 3. Click Heatmap Data
- Track every click coordinate on every page
- Visual heatmap overlay — see exactly where people click
- Identify "dead clicks" (people clicking non-clickable things = design issues)
- Rage clicks (frustrated repeated clicking = UX problems)
- **Why it matters:** Replaces Crazy Egg ($30/mo)

### 4. Product Engagement Funnel (beyond Shopify's)
- Product card hover → Modal open → Image browse → Add to cart → Checkout
- Shopify only tracks view → purchase. We track EVERY micro-step
- Per-product funnel visualization
- "People looked at Golden Girls magnets 200 times but only 5 added to cart" = pricing/photo issue
- **Why it matters:** Micro-conversion tracking Shopify doesn't offer

### 5. Session Recordings (Scroll + Click Timeline)
- Record scroll + click timeline per session
- Replay how a visitor navigated your site
- Session duration, pages visited, exit page
- Filter by: high-intent, bounced, converted
- **Why it matters:** Replaces Hotjar ($40/mo)

### 6. A/B Testing Engine
- Test different headlines, hero images, CTA colors, prices displayed
- Auto-split visitors 50/50 (or custom ratio)
- Track which version gets more clicks/add-to-carts
- Statistical significance calculator
- **Why it matters:** Replaces Optimizely ($100+/mo)

### 7. Newsletter Popup Analytics
- Popup shown → dismissed vs submitted
- Conversion rate over time (daily/weekly chart)
- Best time-of-day for popup conversions
- Dismiss reason tracking (X button vs click-outside vs escape key)
- **Why it matters:** Shopify doesn't track popup performance at all

### 8. Visitor Intent Scoring
- Score each visitor: 🟢 High / 🟡 Medium / 🔴 Low intent
- Scoring criteria:
  - High intent = viewed product 3+ times, opened modal, scrolled to reviews, added to cart
  - Medium = viewed 2+ products, spent 60s+ on site
  - Low = single page view, bounced quickly
- Real-time intent distribution pie chart
- **Why it matters:** Understand visitor quality, not just quantity

### 9. Traffic Source Deep Dive
- Referrer breakdown with actual page paths
- UTM campaign tracking with custom dashboard
- "Which Instagram post drove the most traffic?"
- Social vs Organic vs Direct vs Paid split
- Top referrer URLs ranked by visits
- **Why it matters:** More granular than Shopify's basic source tracking

### 10. Device & Performance Dashboard
- Real User Metrics (RUM) — actual load times from real visitors
- Core Web Vitals tracked over time:
  - LCP (Largest Contentful Paint)
  - FID (First Input Delay) / INP (Interaction to Next Paint)
  - CLS (Cumulative Layout Shift)
- Performance breakdown by device, browser, connection speed
- Mobile vs Desktop engagement comparison
- **Why it matters:** Google ranks you based on these — Shopify doesn't show them

### 11. Revenue Estimator & Forecasting
- Traffic × estimated conversion rate × AOV = projected revenue
- Trend lines: "Traffic is up 20% this week"
- Seasonal pattern detection
- Day-of-week and hour-of-day traffic patterns
- Goal tracking (set monthly traffic/conversion targets)
- **Why it matters:** Forward-looking insights Shopify doesn't provide

### 12. Cart Analytics (Shopify doesn't show these)
- Items frequently added together (cross-sell opportunities)
- Time from first page view to add-to-cart
- Cart additions by time of day / day of week
- Most abandoned products (added to cart but didn't checkout)
- Average items per cart
- **Why it matters:** Cross-sell and timing data Shopify hides behind expensive plans

### 13. SEO Command Center
- Live audit of all pages:
  - Missing meta descriptions
  - Missing OG images
  - Missing image alt tags
  - Missing H1 headings
  - Schema/JSON-LD validation
- Google PageSpeed scores embedded (via API)
- Keyword rankings tracker (manual input with history)
- Broken link detector
- Sitemap validator
- **Why it matters:** Replaces paid SEO tools ($50+/mo)

### 14. Error & Uptime Monitoring
- JS error tracking from real visitors (error message, stack trace, page, browser)
- 404 page hits — what URLs are people trying?
- Image load failures
- API failures (Shopify cart API errors)
- Response time monitoring
- **Why it matters:** Replaces UptimeRobot ($7/mo) + Sentry (free tier)

### 15. Social Proof Engine
- Auto-generate badges on product pages based on REAL data:
  - "🔥 12 people viewed this today"
  - "Added to cart 5 times this week"
  - "⚡ Trending — 3x more views than last week"
- No fake numbers — all driven by actual Firebase tracking data
- Configurable thresholds in admin dashboard
- **Why it matters:** Social proof increases conversions 15-20% — most tools charge $20+/mo

### 16. Automated Weekly Digest
- Generate a summary report:
  - Top pages by views
  - Top products by engagement
  - Traffic trends (up/down vs last week)
  - Issues detected (errors, broken links, slow pages)
  - New vs returning visitor ratio
- Copy-paste ready text for email to Alyssa
- One-click generate button
- **Why it matters:** Saves 30+ minutes of manual analytics review weekly

---

## 💰 Total Value — What This Replaces

| Tool | Monthly Cost | Our Version |
|------|-------------|-------------|
| Hotjar (heatmaps/recordings) | $40/mo | ✅ Free |
| Optimizely (A/B testing) | $100+/mo | ✅ Free |
| Lucky Orange (live visitors) | $20/mo | ✅ Free |
| Crazy Egg (scroll maps) | $30/mo | ✅ Free |
| UptimeRobot (monitoring) | $7/mo | ✅ Free |
| SEO audit tools | $50+/mo | ✅ Free |
| Social proof widgets | $20+/mo | ✅ Free |
| **Total savings** | **~$270/mo ($3,240/yr)** | **$0** |

---

## 🔒 Security
- Client-side password gate with SHA-256 hashed password
- `noindex, nofollow` meta tag to hide from search engines
- `robots.txt` disallow `/admin/`
- No sensitive data exposed — all analytics are behavioral, no PII

---

## 🎨 Design
- Dark theme dashboard (charcoal/slate background)
- Brand accent colors (Primary #C77D8A, Green #7A9D54, Gold #D4A574)
- Responsive — works on mobile for quick checks
- Card-based layout with collapsible sections
- Chart.js for all visualizations

---

## 📁 File Structure
```
/admin/
  index.html          — Main dashboard page
/assets/js/
  mm-tracker.js       — Lightweight tracking script (~3KB, loaded on all pages)
  admin-dashboard.js  — Dashboard logic (only loaded on admin page)
/assets/css/
  admin.css           — Dashboard styles
```

---

## 🔧 Entry Point
- Tiny gear icon (⚙️) in the footer of every page
- Subtle/discreet — customers won't notice
- Links to `/admin/`

---

## 📋 Implementation Priority
1. **Phase 1 — Foundation:** Firebase setup, tracking script, password gate, admin shell
2. **Phase 2 — Core Analytics:** Live visitors, scroll depth, click heatmap, traffic sources
3. **Phase 3 — Product Intelligence:** Engagement funnel, cart analytics, social proof engine
4. **Phase 4 — Advanced:** A/B testing, session recordings, intent scoring
5. **Phase 5 — Operations:** SEO audit, error monitoring, weekly digest, revenue forecasting

---

*Document created: February 16, 2026*
*Status: Ready for implementation*
