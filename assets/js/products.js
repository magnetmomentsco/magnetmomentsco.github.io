/**
 * Live Product Sync — Magnet Moments Co.
 * =======================================
 * Client-side freshness layer that runs on top of the statically-rendered
 * product cards (pre-built by GitHub Actions / sync-products.py).
 *
 * What it does:
 *   1. Fetches LIVE product data from Shopify Storefront API (cache: no-store)
 *   2. Updates existing product cards: prices, availability, sold-out status
 *   3. Hides products that have been unpublished since the last build
 *   4. Dynamically renders NEW products added since the last build
 *
 * SEO is handled by the static HTML — this script only patches the live state.
 * If the API call fails, the static HTML is still perfectly functional.
 */

(function () {
  'use strict';

  // ─── Config ─────────────────────────────────────────
  var SHOPIFY_DOMAIN = 'dbx3hf-qe.myshopify.com';
  var STOREFRONT_TOKEN = '3ed866388b8a983188443f1d808fd561';
  var API_VERSION = '2025-01';
  var ENDPOINT = 'https://' + SHOPIFY_DOMAIN + '/api/' + API_VERSION + '/graphql.json';

  // ─── GraphQL query ──────────────────────────────────
  var PRODUCTS_QUERY = [
    '{',
    '  products(first: 50, sortKey: PRICE, reverse: false) {',
    '    nodes {',
    '      id',
    '      handle',
    '      title',
    '      tags',
    '      availableForSale',
    '      totalInventory',
    '      onlineStoreUrl',
    '      priceRange {',
    '        minVariantPrice { amount currencyCode }',
    '        maxVariantPrice { amount currencyCode }',
    '      }',
    '      featuredImage { url altText }',
    '      variants(first: 10) {',
    '        nodes {',
    '          id',
    '          title',
    '          price { amount currencyCode }',
    '          availableForSale',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');

  // ─── Helpers ────────────────────────────────────────

  function isCustomProduct(product) {
    var tags = (product.tags || []).map(function (t) { return t.toLowerCase(); });
    return tags.indexOf('custom') !== -1;
  }

  function getBadgeText(product) {
    var tags = (product.tags || []).map(function (t) { return t.toLowerCase(); });
    if (tags.indexOf('bestseller') !== -1 || tags.indexOf('best seller') !== -1) return 'Best Seller';
    if (tags.indexOf('new') !== -1) return 'New';
    if (tags.indexOf('sale') !== -1) return 'Sale';
    return null;
  }

  function isFeatured(product) {
    var tags = (product.tags || []).map(function (t) { return t.toLowerCase(); });
    return tags.indexOf('featured') !== -1;
  }

  function formatPrice(product) {
    var pr = product.priceRange || {};
    var min = parseFloat((pr.minVariantPrice || {}).amount || '0');
    var max = parseFloat((pr.maxVariantPrice || {}).amount || '0');
    if (min === 0) return 'Free';
    var formatted = '$' + min.toFixed(2);
    if (min !== max) return '<span class="from">From </span>' + formatted;
    return formatted;
  }

  function getImageUrl(product, width) {
    width = width || 600;
    var img = product.featuredImage;
    if (!img || !img.url) return '';
    var url = img.url;
    if (url.indexOf('?') !== -1) return url + '&width=' + width;
    return url + '?width=' + width;
  }

  function getFirstVariantId(product) {
    var variants = (product.variants || {}).nodes || [];
    return variants.length ? variants[0].id : '';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Fetch live products ────────────────────────────

  function fetchLiveProducts() {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query: PRODUCTS_QUERY }),
      cache: 'no-store',
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json.errors) {
          console.warn('[ProductSync] API errors:', json.errors);
          return [];
        }
        return json.data.products.nodes;
      });
  }

  // ─── Update existing product cards ──────────────────

  function updateExistingCards(liveProducts) {
    var productMap = {};
    liveProducts.forEach(function (p) { productMap[p.id] = p; });

    // Track which live products are already rendered
    var renderedIds = {};

    document.querySelectorAll('.product-card[data-product-id]').forEach(function (card) {
      var productId = card.getAttribute('data-product-id');
      renderedIds[productId] = true;
      var product = productMap[productId];

      if (!product) {
        // Product removed from Shopify — hide it
        card.style.display = 'none';
        return;
      }

      // Update availability
      if (!product.availableForSale) {
        card.classList.add('sold-out');
        var btn = card.querySelector('.product-card-btn');
        if (btn && btn.tagName === 'BUTTON') {
          btn.disabled = true;
          btn.textContent = 'Sold Out';
        }
        // Add sold out badge if not present
        var existingBadge = card.querySelector('.product-card-badge');
        if (existingBadge) {
          existingBadge.textContent = 'Sold Out';
          existingBadge.classList.add('sold-out-badge');
        } else {
          var imgWrap = card.querySelector('.product-card-image');
          if (imgWrap) {
            var badge = document.createElement('span');
            badge.className = 'product-card-badge sold-out-badge';
            badge.textContent = 'Sold Out';
            imgWrap.appendChild(badge);
          }
        }
      } else {
        // Back in stock
        card.classList.remove('sold-out');
        var btn2 = card.querySelector('.product-card-btn');
        if (btn2 && btn2.tagName === 'BUTTON' && btn2.disabled) {
          btn2.disabled = false;
          btn2.textContent = btn2.getAttribute('data-original-text') || 'Add to Cart';
        }
        // Remove sold out badge
        var soldBadge = card.querySelector('.sold-out-badge');
        if (soldBadge) {
          var badgeText = getBadgeText(product);
          if (badgeText) {
            soldBadge.textContent = badgeText;
            soldBadge.classList.remove('sold-out-badge');
          } else {
            soldBadge.remove();
          }
        }
      }

      // Update price
      var priceEl = card.querySelector('.product-card-price');
      if (priceEl) {
        var newPrice = formatPrice(product);
        if (priceEl.innerHTML !== newPrice) {
          priceEl.innerHTML = newPrice;
        }
      }
    });

    // Return products NOT already in static HTML (new products)
    return liveProducts.filter(function (p) {
      return !renderedIds[p.id];
    });
  }

  // ─── Render a new product card dynamically ──────────

  function renderNewProductCard(product, isShopPage) {
    var title = escapeHtml(product.title);
    var productId = product.id;
    var category = isCustomProduct(product) ? 'custom' : 'premade';
    var priceHtml = formatPrice(product);
    var imageUrl = getImageUrl(product);
    var imageAlt = (product.featuredImage && product.featuredImage.altText) || title;
    var badge = getBadgeText(product);
    var available = product.availableForSale;
    var isCustom = isCustomProduct(product);
    var variantId = getFirstVariantId(product);

    var card = document.createElement('div');
    card.className = 'product-card' + (available ? '' : ' sold-out');
    card.setAttribute('data-product-id', productId);
    if (isShopPage) card.setAttribute('data-category', category);

    // Check current filter state — hide if doesn't match active filter
    if (isShopPage) {
      var activeFilter = document.querySelector('.filter-btn[aria-pressed="true"]');
      if (activeFilter) {
        var currentFilter = activeFilter.getAttribute('data-filter');
        if (currentFilter !== 'all' && currentFilter !== category) {
          card.style.display = 'none';
        }
      }
    }

    var badgeHtml = '';
    if (!available) {
      badgeHtml = '<span class="product-card-badge sold-out-badge">Sold Out</span>';
    } else if (badge) {
      badgeHtml = '<span class="product-card-badge">' + badge + '</span>';
    }

    var ctaHtml;
    if (isCustom) {
      var shopifyUrl = product.onlineStoreUrl || ('https://' + SHOPIFY_DOMAIN + '/products/' + product.handle);
      ctaHtml = '<a href="' + escapeHtml(shopifyUrl) + '" class="product-card-btn" target="_blank" rel="noopener">View &amp; Customize →</a>';
    } else if (!available) {
      ctaHtml = '<button class="product-card-btn" data-variant-id="' + escapeHtml(variantId) + '" data-original-text="Add to Cart" aria-label="Add ' + title + ' to cart" disabled>Sold Out</button>';
    } else {
      ctaHtml = '<button class="product-card-btn" data-variant-id="' + escapeHtml(variantId) + '" data-original-text="Add to Cart" aria-label="Add ' + title + ' to cart">Add to Cart</button>';
    }

    card.innerHTML =
      '<a href="/shop/' + (product.handle || '') + '/" class="product-card-link" aria-label="' + title + '">' +
      '<div class="product-card-image">' +
        (imageUrl ? '<img src="' + imageUrl + '" alt="' + escapeHtml(imageAlt) + '" width="600" height="600" loading="lazy">' : '') +
        badgeHtml +
      '</div>' +
      '<div class="product-card-body">' +
        '<h3 class="product-card-title">' + title + '</h3>' +
        '<p class="product-card-price">' + priceHtml + '</p>' +
      '</div>' +
      '</a>' +
      '<div class="product-card-actions">' +
        ctaHtml +
      '</div>';

    // Fade in animation
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      });
    });

    return card;
  }

  // ─── Main sync logic ───────────────────────────────

  function updateProductDetailPage(liveProducts) {
    // Check if we're on a PDP (product detail page)
    var pdpSection = document.querySelector('.pdp[data-product-id]');
    if (!pdpSection) return;

    var productId = pdpSection.getAttribute('data-product-id');
    var product = null;
    liveProducts.forEach(function (p) { if (p.id === productId) product = p; });

    if (!product) return;

    // Update price
    var priceEl = pdpSection.querySelector('.pdp-price');
    if (priceEl) {
      priceEl.innerHTML = formatPrice(product);
    }

    // Update availability
    var ctaBtn = pdpSection.querySelector('.pdp-cta');
    if (ctaBtn) {
      if (!product.availableForSale) {
        if (ctaBtn.tagName === 'BUTTON') {
          ctaBtn.disabled = true;
          ctaBtn.textContent = 'Sold Out';
        }
      } else {
        if (ctaBtn.tagName === 'BUTTON' && ctaBtn.disabled) {
          ctaBtn.disabled = false;
          ctaBtn.textContent = ctaBtn.getAttribute('data-original-text') || 'Add to Cart';
        }
      }
    }

    console.log('[ProductSync] PDP updated for: ' + product.title);
  }

  function syncProducts() {
    fetchLiveProducts()
      .then(function (liveProducts) {
        if (!liveProducts || liveProducts.length === 0) {
          console.log('[ProductSync] No products returned or API error — using static HTML');
          return;
        }

        // Update PDP (product detail page) if present
        updateProductDetailPage(liveProducts);

        // Update existing cards (prices, availability)
        var newProducts = updateExistingCards(liveProducts);

        if (newProducts.length === 0) {
          console.log('[ProductSync] All products up to date (' + liveProducts.length + ' products)');
          return;
        }

        console.log('[ProductSync] Found ' + newProducts.length + ' new product(s) not in static HTML');

        // Shop page: add to products-grid
        var shopGrid = document.querySelector('.products-grid');
        var isShopPage = !!document.querySelector('[data-filter]');

        if (shopGrid && isShopPage) {
          newProducts.forEach(function (p) {
            var card = renderNewProductCard(p, true);
            shopGrid.appendChild(card);
          });
        }

        // Home page: add featured to featured grid
        var featuredGrid = document.querySelector('.products-grid');
        var isHomePage = !!document.getElementById('home');

        if (featuredGrid && isHomePage) {
          newProducts
            .filter(function (p) { return isFeatured(p) && p.availableForSale; })
            .forEach(function (p) {
              var card = renderNewProductCard(p, false);
              featuredGrid.appendChild(card);
            });
        }
      })
      .catch(function (err) {
        // Graceful degradation — static HTML still works perfectly
        console.warn('[ProductSync] Live sync failed, static HTML still active:', err.message);
      });
  }

  // ─── Init ──────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncProducts);
  } else {
    syncProducts();
  }

})();
