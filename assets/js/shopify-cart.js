/**
 * Shopify Cart Integration (Storefront GraphQL — Cart API)
 * Magnet Moments Co.
 *
 * Talks directly to the Storefront GraphQL API using the Cart API
 * (cartCreate, cartLinesAdd, cartLinesUpdate, cartLinesRemove).
 * The old Checkout API (used by JS Buy SDK v2) was removed in 2025-01.
 */

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────
  var SHOPIFY_DOMAIN = 'dbx3hf-qe.myshopify.com';
  var STOREFRONT_TOKEN = '3ed866388b8a983188443f1d808fd561';
  var API_VERSION = '2025-01';
  var ENDPOINT = 'https://' + SHOPIFY_DOMAIN + '/api/' + API_VERSION + '/graphql.json';
  var CART_STORAGE_KEY = 'magnetmomentsco_cart_id';

  var cart = null; // { id, checkoutUrl, lines[], subtotal, total }

  // ─── GraphQL helper ───────────────────────────────────
  function gql(query, variables) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN,
      },
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json.errors) {
          console.error('Shopify API errors:', json.errors);
          throw new Error(json.errors[0].message);
        }
        return json.data;
      });
  }

  // ─── Shared cart fields fragment ──────────────────────
  var CART_FRAGMENT = [
    'fragment CF on Cart {',
    '  id',
    '  checkoutUrl',
    '  lines(first: 50) {',
    '    edges {',
    '      node {',
    '        id',
    '        quantity',
    '        merchandise {',
    '          ... on ProductVariant {',
    '            id title',
    '            price { amount currencyCode }',
    '            product { title }',
    '            image { url }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '  cost {',
    '    subtotalAmount { amount currencyCode }',
    '    totalAmount   { amount currencyCode }',
    '  }',
    '}',
  ].join('\n');

  // ─── Parse raw cart into a flat object ────────────────
  function parseCart(raw) {
    if (!raw) return null;
    var lines = [];
    if (raw.lines && raw.lines.edges) {
      lines = raw.lines.edges.map(function (e) {
        var n = e.node;
        var m = n.merchandise || {};
        return {
          id: n.id,
          quantity: n.quantity,
          title: (m.product && m.product.title) || '',
          variantTitle: m.title || '',
          variantId: m.id || '',
          price: (m.price && m.price.amount) || '0.00',
          image: (m.image && m.image.url) || '',
        };
      });
    }
    return {
      id: raw.id,
      checkoutUrl: raw.checkoutUrl,
      lines: lines,
      subtotal: (raw.cost && raw.cost.subtotalAmount && raw.cost.subtotalAmount.amount) || '0.00',
      total: (raw.cost && raw.cost.totalAmount && raw.cost.totalAmount.amount) || '0.00',
    };
  }

  // ─── Create a new cart ────────────────────────────────
  function createCart() {
    var q = 'mutation { cartCreate(input: {}) { cart { ...CF } userErrors { field message } } }\n' + CART_FRAGMENT;
    return gql(q).then(function (data) {
      cart = parseCart(data.cartCreate.cart);
      if (cart) localStorage.setItem(CART_STORAGE_KEY, cart.id);
      updateCartUI();
      return cart;
    });
  }

  // ─── Fetch an existing cart ───────────────────────────
  function fetchCart(cartId) {
    var q = 'query($id: ID!) { cart(id: $id) { ...CF } }\n' + CART_FRAGMENT;
    return gql(q, { id: cartId }).then(function (data) {
      if (data.cart) {
        cart = parseCart(data.cart);
        updateCartUI();
        return cart;
      }
      // Cart expired — create a fresh one
      localStorage.removeItem(CART_STORAGE_KEY);
      return createCart();
    }).catch(function () {
      localStorage.removeItem(CART_STORAGE_KEY);
      return createCart();
    });
  }

  // ─── Add to cart ──────────────────────────────────────
  function addToCart(variantId, quantity) {
    if (!cart) return Promise.resolve();
    quantity = quantity || 1;
    if (variantId.indexOf('gid://') !== 0) {
      variantId = 'gid://shopify/ProductVariant/' + variantId;
    }

    var q = [
      'mutation($cartId: ID!, $lines: [CartLineInput!]!) {',
      '  cartLinesAdd(cartId: $cartId, lines: $lines) {',
      '    cart { ...CF }',
      '    userErrors { field message }',
      '  }',
      '}',
      CART_FRAGMENT,
    ].join('\n');

    return gql(q, {
      cartId: cart.id,
      lines: [{ merchandiseId: variantId, quantity: quantity }],
    }).then(function (data) {
      var errs = data.cartLinesAdd.userErrors;
      if (errs && errs.length) {
        console.error('Add to cart errors:', errs);
        throw new Error(errs[0].message);
      }
      cart = parseCart(data.cartLinesAdd.cart);
      if (cart) localStorage.setItem(CART_STORAGE_KEY, cart.id);
      updateCartUI();
      openCartDrawer();
      showAddedFeedback();
      return cart;
    }).catch(function (err) {
      console.error('Add to cart failed:', err);
      // Cart might be invalid — recreate
      return createCart();
    });
  }

  // ─── Update line quantity ─────────────────────────────
  function updateQuantity(lineId, quantity) {
    if (!cart) return Promise.resolve();
    if (quantity < 1) return removeItem(lineId);

    var q = [
      'mutation($cartId: ID!, $lines: [CartLineUpdateInput!]!) {',
      '  cartLinesUpdate(cartId: $cartId, lines: $lines) {',
      '    cart { ...CF }',
      '    userErrors { field message }',
      '  }',
      '}',
      CART_FRAGMENT,
    ].join('\n');

    return gql(q, {
      cartId: cart.id,
      lines: [{ id: lineId, quantity: quantity }],
    }).then(function (data) {
      cart = parseCart(data.cartLinesUpdate.cart);
      updateCartUI();
    });
  }

  // ─── Remove line item ────────────────────────────────
  function removeItem(lineId) {
    if (!cart) return Promise.resolve();

    var q = [
      'mutation($cartId: ID!, $lineIds: [ID!]!) {',
      '  cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {',
      '    cart { ...CF }',
      '    userErrors { field message }',
      '  }',
      '}',
      CART_FRAGMENT,
    ].join('\n');

    return gql(q, {
      cartId: cart.id,
      lineIds: [lineId],
    }).then(function (data) {
      cart = parseCart(data.cartLinesRemove.cart);
      updateCartUI();
    });
  }

  // ─── Cart Drawer ──────────────────────────────────────
  var cartTriggerEl = null; // element that opened the cart (for focus return)

  function openCartDrawer() {
    var drawer = document.getElementById('cart-drawer');
    var overlay = document.getElementById('cart-overlay');
    if (drawer) {
      cartTriggerEl = document.activeElement;
      drawer.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      // Focus the close button
      var closeBtn = drawer.querySelector('.cart-close');
      if (closeBtn) closeBtn.focus();
    }
  }

  function closeCartDrawer() {
    var drawer = document.getElementById('cart-drawer');
    var overlay = document.getElementById('cart-overlay');
    if (drawer) {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      // Return focus to trigger element
      if (cartTriggerEl && cartTriggerEl.focus) {
        cartTriggerEl.focus();
        cartTriggerEl = null;
      }
    }
  }

  // Focus trap for cart drawer
  function trapFocusInCart(e) {
    var drawer = document.getElementById('cart-drawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    if (e.key === 'Escape') { closeCartDrawer(); return; }
    if (e.key !== 'Tab') return;
    var focusable = drawer.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function showAddedFeedback() {
    var badge = document.querySelector('.cart-badge');
    if (badge) {
      badge.classList.add('pop');
      setTimeout(function () { badge.classList.remove('pop'); }, 400);
    }
  }

  // ─── Render cart UI ───────────────────────────────────
  function updateCartUI() {
    if (!cart) return;

    var lines = cart.lines || [];
    var itemCount = lines.reduce(function (s, l) { return s + l.quantity; }, 0);

    // Badge
    document.querySelectorAll('.cart-count').forEach(function (el) {
      el.textContent = itemCount;
      el.style.display = itemCount > 0 ? 'flex' : 'none';
    });

    var itemsContainer = document.getElementById('cart-items');
    var emptyState = document.getElementById('cart-empty');
    var cartFooter = document.getElementById('cart-footer');
    var subtotalEl = document.getElementById('cart-subtotal');

    if (!itemsContainer) return;

    if (lines.length === 0) {
      itemsContainer.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (cartFooter) cartFooter.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (cartFooter) cartFooter.style.display = 'block';

    itemsContainer.innerHTML = lines.map(function (item) {
      var imgTag = item.image
        ? '<img class="cart-item-img" src="' + item.image + '&width=120" alt="' + item.title + '" width="60" height="60">'
        : '<div class="cart-item-img cart-item-img-placeholder"></div>';
      var variantLabel = item.variantTitle && item.variantTitle !== 'Default Title'
        ? '<p class="cart-item-variant">' + item.variantTitle + '</p>'
        : '';
      var lineTotal = (parseFloat(item.price) * item.quantity).toFixed(2);

      return '<div class="cart-item">' +
        imgTag +
        '<div class="cart-item-details">' +
          '<h4 class="cart-item-title">' + item.title + '</h4>' +
          variantLabel +
          '<div class="cart-item-qty">' +
            '<button class="qty-btn" data-line-id="' + item.id + '" data-qty="' + (item.quantity - 1) + '" aria-label="Decrease quantity">\u2212</button>' +
            '<span class="qty-value">' + item.quantity + '</span>' +
            '<button class="qty-btn" data-line-id="' + item.id + '" data-qty="' + (item.quantity + 1) + '" aria-label="Increase quantity">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-item-right">' +
          '<span class="cart-item-price">$' + lineTotal + '</span>' +
          '<button class="cart-item-remove" data-line-id="' + item.id + '" aria-label="Remove item">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    if (subtotalEl) {
      subtotalEl.textContent = '$' + parseFloat(cart.subtotal).toFixed(2);
    }

    var checkoutBtn = document.getElementById('cart-checkout-btn');
    if (checkoutBtn && cart.checkoutUrl) {
      checkoutBtn.href = cart.checkoutUrl;
    }
  }

  // ─── Event binding ────────────────────────────────────
  function bindCartEvents() {
    document.addEventListener('click', function (e) {
      // Open cart
      if (e.target.closest('.cart-toggle')) {
        e.preventDefault();
        openCartDrawer();
        return;
      }

      // Close cart
      if (e.target.closest('.cart-close') || e.target.closest('#cart-overlay')) {
        closeCartDrawer();
        return;
      }

      // Add to cart
      var addBtn = e.target.closest('[data-variant-id]');
      if (addBtn && !addBtn.classList.contains('adding')) {
        e.preventDefault();
        var vid = addBtn.getAttribute('data-variant-id');
        var origText = addBtn.getAttribute('data-original-text') || 'Add to Cart';
        addBtn.classList.add('adding');
        addBtn.textContent = 'Adding\u2026';
        addToCart(vid, 1).then(function () {
          addBtn.textContent = 'Added \u2713';
          setTimeout(function () {
            addBtn.classList.remove('adding');
            addBtn.textContent = origText;
          }, 1500);
        }).catch(function () {
          addBtn.classList.remove('adding');
          addBtn.textContent = origText;
        });
        return;
      }

      // Qty buttons
      var qtyBtn = e.target.closest('.qty-btn');
      if (qtyBtn) {
        var lid = qtyBtn.getAttribute('data-line-id');
        var nq = parseInt(qtyBtn.getAttribute('data-qty'), 10);
        updateQuantity(lid, nq);
        return;
      }

      // Remove buttons
      var removeBtn = e.target.closest('.cart-item-remove');
      if (removeBtn) {
        removeItem(removeBtn.getAttribute('data-line-id'));
        return;
      }
    });

    // Focus trap & Escape key for cart drawer
    document.addEventListener('keydown', trapFocusInCart);
  }

  // ─── Init ─────────────────────────────────────────────
  function init() {
    bindCartEvents();
    var existingId = localStorage.getItem(CART_STORAGE_KEY);
    if (existingId) {
      fetchCart(existingId);
    } else {
      createCart();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.MagnetCart = {
    addToCart: addToCart,
    openCartDrawer: openCartDrawer,
    closeCartDrawer: closeCartDrawer,
    getCart: function () { return cart; },
  };
})();
