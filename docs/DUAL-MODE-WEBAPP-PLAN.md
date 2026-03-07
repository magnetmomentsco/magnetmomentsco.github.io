# Dual-Mode Web App — Project Plan

## Magnet Moments Co. | Market Mode + Event Mode

---

## 1. Overview

Two new mobile-first web apps added to the existing static site:

| Mode | URL | Purpose |
|------|-----|---------|
| **Market Mode** | `magnetmomentsco.us/market/webapp` | Order builder + photo capture at markets/pop-ups |
| **Event Mode** | `magnetmomentsco.us/event/webapp` | Guest photo capture/upload at events |

Both upload photos to **Google Drive** in organized folders and are triggered via **QR codes**.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   GitHub Pages (Static)                  │
│                                                         │
│  /market/webapp/index.html    /event/webapp/index.html  │
│  ├─ Order builder UI          ├─ Camera capture UI      │
│  ├─ Price + tax calculator    ├─ File upload UI         │
│  ├─ Payment deep-links        ├─ Event ID from QR/URL   │
│  ├─ Camera capture            └─ Upload to Drive        │
│  └─ Upload to Drive                                     │
└──────────────┬──────────────────────┬───────────────────┘
               │                      │
               ▼                      ▼
┌──────────────────────────────────────────────────────────┐
│              Google Apps Script (Backend API)             │
│              ─────────────────────────────                │
│  POST /upload   → Receives photo + metadata              │
│                 → Creates Drive folder if needed          │
│                 → Saves photo to correct folder           │
│                 → Returns confirmation                    │
│                                                          │
│  GET /events    → Returns active events list             │
│  POST /events   → Creates new event (admin)              │
│                                                          │
│  Folder structure in Google Drive:                       │
│  📁 Magnet Moments Uploads/                              │
│     📁 market-2026-03-15/                                │
│        📁 venmo/                                         │
│        📁 paypal/                                        │
│        📁 cash-tap/                                      │
│        📁 shopify/                                       │
│     📁 event-2026-03-20-johnsons-birthday/               │
│        📂 (all guest photos)                             │
└──────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│            Firebase Realtime Database (Existing)          │
│            ─────────────────────────────────              │
│  /events/{eventId}     → Event config (name, date, etc.) │
│  /market-sessions/     → Daily market session tracking    │
│  /orders/{orderId}     → Order records with totals        │
└──────────────────────────────────────────────────────────┘
```

### Why Google Apps Script (not Cloud Functions)?

- **Free forever** — runs under your Google account
- **Direct Google Drive access** — no OAuth setup needed
- **No billing** — Firebase Cloud Functions require Blaze plan for external API calls
- **Simple deployment** — paste code in script.google.com, click Deploy
- Handles files up to 50MB per upload (more than enough for photos)

---

## 3. Market Mode — Detailed Spec

### 3.1 User Flow

```
Customer scans QR → Opens /market/webapp →
  1. Select magnet size (2×2 or 2×3)
  2. Select quantity (Single, 3, 6, 9, 12)
  3. See price + 8.25% tax + total
  4. Capture/upload photo(s)
  5. Choose payment method
     → Venmo: deep-link opens Venmo app with amount
     → PayPal: deep-link opens PayPal.me with amount
     → Cash/Tap: shows "please see a team member"
     → Shopify: redirects to Shopify checkout
  6. Photo uploaded to Google Drive: market-<date>/<payment_method>/
```

### 3.2 Pricing Table

| Size | Single | Set of 3 | Set of 6 | Set of 9 | Set of 12 |
|------|--------|----------|----------|----------|-----------|
| **2×2** | $4.00 | $12.00 | $19.00 | $25.00 | $30.00 |
| **2×3** | $4.50 | $13.50 | $22.00 | $32.00 | $40.00 |

**Tax Rate:** 8.25%

**Example:** 2×3 Set of 6 = $22.00 + $1.82 tax = **$23.82 total**

### 3.3 Payment Deep-Links

| Method | Link Format |
|--------|------------|
| Venmo | `venmo://paycharge?txn=pay&recipients=VENMO_USERNAME&amount=XX.XX&note=MagnetMoments` |
| PayPal | `https://paypal.me/PAYPAL_USERNAME/XX.XX` |
| Cash/Tap | Display message: "Please see a team member to pay for your order" |
| Shopify | Redirect to existing Shopify checkout |

### 3.4 UI Wireframe (Mobile-First)

```
┌──────────────────────────┐
│  🧲 Magnet Moments Co.   │
│     Market Order          │
├──────────────────────────┤
│                          │
│  Choose Your Magnets:    │
│                          │
│  Size:  [2×2] [2×3]     │
│                          │
│  Quantity:               │
│  ○ Single    ── $4.00   │
│  ○ Set of 3  ── $12.00  │
│  ● Set of 6  ── $19.00  │
│  ○ Set of 9  ── $25.00  │
│  ○ Set of 12 ── $30.00  │
│                          │
├──────────────────────────┤
│  Subtotal:     $19.00   │
│  Tax (8.25%):   $1.57   │
│  ─────────────────────   │
│  Total:        $20.57   │
├──────────────────────────┤
│                          │
│  📸 Your Photo(s):       │
│  [Take Photo] [Upload]  │
│                          │
│  ┌────┐ ┌────┐          │
│  │ 📷 │ │ 📷 │          │
│  └────┘ └────┘          │
│                          │
├──────────────────────────┤
│  Pay With:               │
│                          │
│  [💜 Venmo — $20.57   ] │
│  [💙 PayPal — $20.57  ] │
│  [🛒 Shopify Checkout ] │
│  [💵 Cash / Tap       ] │
│                          │
│  "Please send total to   │
│   selected payment       │
│   method. If using cash  │
│   or paying with tap,    │
│   please see a team      │
│   member to pay for      │
│   your order."           │
│                          │
└──────────────────────────┘
```

---

## 4. Event Mode — Detailed Spec

### 4.1 User Flow

```
Guest scans QR → Opens /event/webapp?id=EVENT_ID →
  1. See event name ("Welcome to Johnson's Birthday!")
  2. Choose: [Take Photo] or [Upload Existing]
  3. Camera opens (if Take Photo) or file picker opens
  4. Preview photo → Confirm upload
  5. Photo saved to Google Drive: event-<date>-<event-name>/
  6. "Photo uploaded! Take another?" loop
```

### 4.2 UI Wireframe (Mobile-First)

```
┌──────────────────────────┐
│  🧲 Magnet Moments Co.   │
│                          │
│  📸 Johnson's Birthday    │
│     Photo Booth          │
├──────────────────────────┤
│                          │
│  Share your best moments!│
│                          │
│  ┌──────────────────┐   │
│  │                  │   │
│  │   Camera Preview │   │
│  │                  │   │
│  │    [ 📷 Snap! ]  │   │
│  └──────────────────┘   │
│                          │
│  ── or ──                │
│                          │
│  [📁 Upload from Phone]  │
│                          │
├──────────────────────────┤
│  ✅ 3 photos uploaded     │
│  [Take Another!]         │
│                          │
└──────────────────────────┘
```

---

## 5. Admin Tools (Event Creation)

Added to existing `/admin/` dashboard:

### 5.1 Event Manager

```
┌──────────────────────────────────────┐
│  Create New Event                     │
│                                      │
│  Event Name: [________________]      │
│  Date:       [2026-03-20     ]      │
│  Type:       [Event ▼]  (or Market) │
│                                      │
│  [Create Event]                      │
│                                      │
│  → Generates QR code                 │
│  → Creates Drive folder              │
│  → Provides shareable link           │
├──────────────────────────────────────┤
│  Active Events:                      │
│                                      │
│  🟢 Johnson's Birthday (Mar 20)     │
│     📎 magnetmomentsco.us/event/     │
│        webapp?id=abc123              │
│     📊 12 photos uploaded            │
│     [QR Code] [View Folder] [End]   │
│                                      │
│  🟢 Spring Market (Mar 15)          │
│     📎 magnetmomentsco.us/market/    │
│        webapp                        │
│     📊 28 orders today               │
│     [QR Code] [View Folder]         │
└──────────────────────────────────────┘
```

---

## 6. Technical Deliverables — File Structure

```
magnetmomentsco.github.io/
├── market/
│   └── webapp/
│       └── index.html          ← Market Mode SPA (single file, self-contained)
├── event/
│   └── webapp/
│       └── index.html          ← Event Mode SPA (single file, self-contained)
├── assets/
│   ├── css/
│   │   └── webapp.css          ← Shared styles for both modes
│   └── js/
│       ├── webapp-market.js    ← Market Mode logic
│       ├── webapp-event.js     ← Event Mode logic
│       └── webapp-shared.js    ← Shared: camera, upload, Drive API, Firebase
├── admin/
│   └── index.html              ← Updated with Event Manager section
└── scripts/
    └── google-apps-script/
        └── Code.gs             ← Google Apps Script backend (for reference/deploy)
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Set up Google Apps Script backend
  - [ ] File upload endpoint
  - [ ] Folder creation logic (market-date/payment, event-date-name)
  - [ ] Event CRUD endpoints
  - [ ] Deploy as web app
- [ ] Set up Firebase database schema
  - [ ] /events collection
  - [ ] /market-sessions collection
  - [ ] /orders collection
  - [ ] Security rules
- [ ] Create shared CSS (`webapp.css`)
  - [ ] Mobile-first responsive layout
  - [ ] Match existing brand colors (pink, green, gold, cream)
  - [ ] Camera/upload UI components
- [ ] Create shared JS (`webapp-shared.js`)
  - [ ] In-browser camera (getUserMedia API)
  - [ ] Photo preview/confirm
  - [ ] Upload to Google Apps Script
  - [ ] Firebase helpers

### Phase 2: Market Mode (Week 2)
- [ ] Build Market Mode UI (`market/webapp/index.html`)
  - [ ] Product selector (2×2 / 2×3)
  - [ ] Quantity selector with prices
  - [ ] Real-time price + tax calculation
  - [ ] Photo capture/upload section
  - [ ] Payment method buttons
- [ ] Build Market Mode logic (`webapp-market.js`)
  - [ ] Price calculator with 8.25% tax
  - [ ] Venmo deep-link generation with amount
  - [ ] PayPal deep-link generation with amount
  - [ ] Shopify redirect
  - [ ] Cash/Tap instructions display
  - [ ] Order submission to Firebase
  - [ ] Photo upload to Drive via Apps Script

### Phase 3: Event Mode (Week 3)
- [ ] Build Event Mode UI (`event/webapp/index.html`)
  - [ ] Event loading from URL param (?id=)
  - [ ] Event welcome screen
  - [ ] Camera capture with live preview
  - [ ] File upload alternative
  - [ ] Photo confirmation before upload
  - [ ] Upload counter / success feedback
- [ ] Build Event Mode logic (`webapp-event.js`)
  - [ ] Load event config from Firebase
  - [ ] Camera stream management
  - [ ] Multi-photo upload support
  - [ ] Upload to Drive via Apps Script
  - [ ] Real-time upload counter

### Phase 4: Admin Tools (Week 3-4)
- [ ] Add Event Manager to `/admin/`
  - [ ] Create event form
  - [ ] QR code generation (in-browser, no API needed)
  - [ ] Active events list
  - [ ] Upload stats per event
  - [ ] Market daily session view
- [ ] Add Market Management
  - [ ] Daily order summary
  - [ ] Revenue tracking
  - [ ] Payment method breakdown

### Phase 5: Testing & Polish (Week 4)
- [ ] Cross-browser testing (Safari, Chrome, Firefox on iOS + Android)
- [ ] Camera permission handling (fallback to file upload)
- [ ] Offline-friendly: queue uploads if connection drops
- [ ] Error handling & user feedback
- [ ] Accessibility audit (extend existing Playwright tests)
- [ ] QR code generation + print templates
- [ ] Performance optimization (lazy load camera, compress images before upload)
- [ ] Deploy & end-to-end testing

---

## 8. Google Drive Folder Structure

```
📁 Magnet Moments Uploads/
│
├── 📁 market-2026-03-15/
│   ├── 📁 venmo/
│   │   ├── order-001-photo1.jpg
│   │   └── order-001-photo2.jpg
│   ├── 📁 paypal/
│   │   └── order-002-photo1.jpg
│   ├── 📁 cash-tap/
│   │   └── order-003-photo1.jpg
│   └── 📁 shopify/
│       └── order-004-photo1.jpg
│
├── 📁 event-2026-03-20-johnsons-birthday/
│   ├── guest-photo-001.jpg
│   ├── guest-photo-002.jpg
│   └── guest-photo-003.jpg
│
└── 📁 event-2026-03-22-spring-festival/
    ├── guest-photo-001.jpg
    └── guest-photo-002.jpg
```

---

## 9. Firebase Database Schema

```json
{
  "events": {
    "abc123": {
      "name": "Johnson's Birthday",
      "date": "2026-03-20",
      "type": "event",
      "driveFolderId": "1a2b3c...",
      "active": true,
      "photoCount": 12,
      "createdAt": 1742515200000
    }
  },
  "market-sessions": {
    "2026-03-15": {
      "driveFolderId": "4d5e6f...",
      "orderCount": 28,
      "revenue": {
        "subtotal": 542.00,
        "tax": 44.72,
        "total": 586.72
      },
      "paymentBreakdown": {
        "venmo": 12,
        "paypal": 8,
        "cash-tap": 5,
        "shopify": 3
      }
    }
  },
  "orders": {
    "ord-001": {
      "sessionDate": "2026-03-15",
      "size": "2x3",
      "quantity": "set-of-6",
      "subtotal": 22.00,
      "tax": 1.82,
      "total": 23.82,
      "paymentMethod": "venmo",
      "photoCount": 2,
      "timestamp": 1742060400000
    }
  }
}
```

---

## 10. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Apps Script endpoint open to public | Rate limiting + CORS restriction to magnetmomentsco.us |
| Photo uploads from unknown users | Max file size (10MB), image-only MIME check, virus scan if needed |
| Firebase database access | Security rules: events read-only for clients, write-only for admin |
| Payment amount tampering | Amounts displayed only — actual payment verified on Venmo/PayPal side |
| Camera permissions | Graceful fallback to file upload if denied |
| Admin access | Existing SHA-256 password gate on /admin/ |

---

## 11. Cost Analysis

| Service | Free Tier | Expected Usage | Cost |
|---------|-----------|----------------|------|
| GitHub Pages | Unlimited | Static hosting | **$0** |
| Google Apps Script | 6M min/day, 100MB/execution | Photo uploads | **$0** |
| Firebase Realtime DB | 1GB storage, 10GB/month bandwidth | Event/order metadata | **$0** |
| Google Drive | 15GB (free Google account) | Photo storage | **$0** |
| Firebase Auth | 50K monthly active users | Optional admin auth | **$0** |
| **Total** | | | **$0/month** |

> ⚠️ Google Drive has a 15GB limit on free accounts. For heavy usage, 
> consider upgrading to Google One ($1.99/month for 100GB) or using a 
> Google Workspace account.

---

## 12. Configuration Needed from Client

Before development begins, we need:

1. **Venmo username** — for deep-link `venmo://paycharge?recipients=USERNAME`
2. **PayPal.me link** — e.g., `paypal.me/MagnetMomentsCo`
3. **Google account** — which Google account to connect for Drive storage
4. **Brand assets** — logo for webapp header (or reuse existing site assets)
5. **Approval** — confirm pricing table and tax rate are correct

---

## 13. QR Code Strategy

| When | QR Code Points To |
|------|-------------------|
| Market pop-up (generic) | `magnetmomentsco.us/market/webapp` |
| Specific event | `magnetmomentsco.us/event/webapp?id=EVENT_ID` |

- QR codes generated in-browser on admin dashboard (no external API)
- Downloadable as PNG for printing
- Includes Magnet Moments branding

---

## 14. Dependencies & Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Google Apps Script quota limits | Upload failures at high volume | Queue + retry; monitor quotas |
| Camera API not supported (old browsers) | Can't take photos | Fall back to file upload |
| Venmo deep-link behavior varies by OS | Payment link may not open app | Provide QR code fallback + manual instructions |
| Google Drive storage fills up | No more uploads | Monitor usage; archive old events |
| Firebase free tier bandwidth exceeded | Tracker/DB stops working | Already using conservative data model |

---

## Ready to Build?

Once you approve this plan (and provide the config items in Section 12), we'll start with **Phase 1: Foundation** — setting up the Google Apps Script backend and shared components.
