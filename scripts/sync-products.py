#!/usr/bin/env python3
"""
Shopify Product Sync — Magnet Moments Co.
==========================================
Fetches all products from the Shopify Storefront API and:
  1. Saves raw data to _data/products.json
  2. Generates SEO-friendly static HTML product cards
  3. Injects them into shop/index.html and index.html
  4. Generates JSON-LD Product structured data for SEO

Run locally:  python3 scripts/sync-products.py
Run in CI:    triggered by .github/workflows/sync-products.yml
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from html import escape
from urllib.request import Request, urlopen

# ─── Config ──────────────────────────────────────────────
SHOPIFY_DOMAIN = os.environ.get('SHOPIFY_DOMAIN', 'dbx3hf-qe.myshopify.com')
STOREFRONT_TOKEN = os.environ.get('SHOPIFY_STOREFRONT_TOKEN', '3ed866388b8a983188443f1d808fd561')
API_VERSION = '2025-01'
ENDPOINT = f'https://{SHOPIFY_DOMAIN}/api/{API_VERSION}/graphql.json'

# Paths (relative to repo root)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, '_data')
DATA_FILE = os.path.join(DATA_DIR, 'products.json')
SHOP_HTML = os.path.join(REPO_ROOT, 'shop', 'index.html')
HOME_HTML = os.path.join(REPO_ROOT, 'index.html')


# ─── GraphQL Query ───────────────────────────────────────
PRODUCTS_QUERY = """
{
  products(first: 50, sortKey: PRICE, reverse: false) {
    nodes {
      id
      handle
      title
      description(truncateAt: 200)
      descriptionHtml
      productType
      tags
      availableForSale
      totalInventory
      onlineStoreUrl
      createdAt
      updatedAt
      seo {
        title
        description
      }
      priceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      compareAtPriceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      featuredImage {
        url
        altText
        width
        height
      }
      images(first: 10) {
        nodes {
          url
          altText
          width
          height
        }
      }
      variants(first: 10) {
        nodes {
          id
          title
          price { amount currencyCode }
          availableForSale
          quantityAvailable
        }
      }
    }
  }
}
"""


def fetch_products():
    """Fetch all products from Shopify Storefront API."""
    req = Request(ENDPOINT, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('X-Shopify-Storefront-Access-Token', STOREFRONT_TOKEN)
    body = json.dumps({'query': PRODUCTS_QUERY}).encode()

    print(f'Fetching products from {SHOPIFY_DOMAIN}...')
    resp = urlopen(req, body, timeout=30)
    data = json.loads(resp.read().decode())

    if 'errors' in data:
        print(f'API errors: {data["errors"]}', file=sys.stderr)
        sys.exit(1)

    products = data['data']['products']['nodes']
    print(f'  Found {len(products)} products')
    return products


def save_json(products):
    """Save products to _data/products.json."""
    os.makedirs(DATA_DIR, exist_ok=True)
    payload = {
        'lastUpdated': datetime.now(timezone.utc).isoformat(),
        'shopifyDomain': SHOPIFY_DOMAIN,
        'productCount': len(products),
        'products': products,
    }
    with open(DATA_FILE, 'w') as f:
        json.dump(payload, f, indent=2)
    print(f'  Saved {DATA_FILE}')


def is_custom_product(product):
    """Check if product requires Shopify hosted page (photo upload).

    These are the products where the customer uploads their own photos,
    so they must complete the order on Shopify, not via headless cart.

    Detection (in priority order):
      1. Tag "Custom Photo Magnets" — Alyssa adds this in Shopify Admin
      2. Title contains "custom photo" (legacy fallback)
    """
    # Check tags first — this is the recommended approach
    tags_lower = [t.lower() for t in product.get('tags', [])]
    if 'custom photo magnets' in tags_lower:
        return True
    # Fallback: check title
    title_lower = product.get('title', '').lower()
    return 'custom photo' in title_lower


def get_badge(product):
    """Determine badge text from tags."""
    tags_lower = [t.lower() for t in product.get('tags', [])]
    if 'bestseller' in tags_lower or 'best seller' in tags_lower:
        return 'Best Seller'
    if 'new' in tags_lower:
        return 'New'
    if 'sale' in tags_lower:
        return 'Sale'
    return None


def format_price(product):
    """Format price display string."""
    pr = product.get('priceRange', {})
    min_price = float(pr.get('minVariantPrice', {}).get('amount', '0'))
    max_price = float(pr.get('maxVariantPrice', {}).get('amount', '0'))

    if min_price == 0:
        return 'Free'

    formatted_min = f'${min_price:.2f}'
    if min_price != max_price:
        return f'<span class="from">From </span>{formatted_min}'
    return formatted_min


def get_image_url(product, width=600):
    """Get featured image URL with width parameter."""
    img = product.get('featuredImage')
    if not img or not img.get('url'):
        return ''
    url = img['url']
    # Shopify CDN URLs support ?width= param
    if '?' in url:
        return url + f'&width={width}'
    return url + f'?width={width}'


def get_image_alt(product):
    """Get image alt text."""
    img = product.get('featuredImage')
    if img and img.get('altText'):
        return escape(img['altText'])
    return escape(product.get('title', ''))


def get_category(product):
    """Determine product category for filter."""
    if is_custom_product(product):
        return 'custom'
    return 'premade'


def get_first_variant_id(product):
    """Get the first variant ID for add-to-cart."""
    variants = product.get('variants', {}).get('nodes', [])
    if variants:
        return variants[0].get('id', '')
    return ''


def build_product_card(product, is_shop_page=True):
    """Generate a single product card HTML."""
    title = escape(product.get('title', ''))
    product_id = product.get('id', '')
    handle = product.get('handle', '')
    category = get_category(product)
    price_html = format_price(product)
    image_url = get_image_url(product)
    image_alt = get_image_alt(product)
    badge = get_badge(product)
    available = product.get('availableForSale', True)
    is_custom = is_custom_product(product)
    variant_id = get_first_variant_id(product)

    # Build badge HTML
    badge_html = ''
    if badge:
        badge_html = f'\n            <span class="product-card-badge">{badge}</span>'
    if not available:
        badge_html = '\n            <span class="product-card-badge sold-out-badge">Sold Out</span>'

    # Category attribute (only on shop page for filters)
    cat_attr = f' data-category="{category}"' if is_shop_page else ''

    # Sold out class
    sold_out_class = ' sold-out' if not available else ''

    # CTA button/link
    if is_custom:
        # Always use myshopify.com domain — custom domain will point to GH Pages after DNS migration
        shopify_url = f'https://{SHOPIFY_DOMAIN}/products/{handle}'
        cta = f'<a href="{escape(shopify_url)}" class="product-card-btn" target="_blank" rel="noopener">View &amp; Customize →</a>'
    elif not available:
        cta = f'<button class="product-card-btn" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" aria-label="Add {title} to cart" disabled>Sold Out</button>'
    else:
        cta = f'<button class="product-card-btn" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" aria-label="Add {title} to cart">Add to Cart</button>'

    return f"""        <div class="product-card{sold_out_class}" data-product-id="{escape(product_id)}"{cat_attr}>
          <a href="/shop/{handle}/" class="product-card-link" aria-label="{title}">
            <div class="product-card-image">
              <img src="{image_url}" alt="{image_alt}" width="600" height="600" loading="lazy">{badge_html}
            </div>
            <div class="product-card-body">
              <h3 class="product-card-title">{title}</h3>
              <p class="product-card-price">{price_html}</p>
            </div>
          </a>
          <div class="product-card-actions">
            {cta}
          </div>
        </div>"""


def build_product_page_html(product, all_products):
    """Generate a full product detail page HTML for SEO."""
    title = escape(product.get('title', ''))
    handle = product.get('handle', '')
    description_html = product.get('descriptionHtml', '')
    description_text = product.get('description', '')
    product_id = product.get('id', '')
    is_custom = is_custom_product(product)
    available = product.get('availableForSale', True)
    variant_id = get_first_variant_id(product)
    price_html = format_price(product)
    badge = get_badge(product)
    category = get_category(product)

    # SEO fields
    seo = product.get('seo') or {}
    seo_title = escape(seo.get('title') or product.get('title', ''))
    seo_description = escape(seo.get('description') or description_text or '')

    # Images
    images = product.get('images', {}).get('nodes', [])
    featured_img = product.get('featuredImage') or (images[0] if images else None)
    og_image = ''
    if featured_img and featured_img.get('url'):
        og_image = featured_img['url']
        if '?' in og_image:
            og_image += '&width=1200'
        else:
            og_image += '?width=1200'

    # Price info for JSON-LD
    pr = product.get('priceRange', {})
    min_price = pr.get('minVariantPrice', {}).get('amount', '0')
    max_price = pr.get('maxVariantPrice', {}).get('amount', '0')
    currency = pr.get('minVariantPrice', {}).get('currencyCode', 'USD')

    # Compare-at price for sale detection
    compare_pr = product.get('compareAtPriceRange', {})
    compare_min = compare_pr.get('minVariantPrice', {}).get('amount', '0')

    # Badge HTML
    badge_html = ''
    if badge:
        badge_html = f'<span class="pdp-badge">{badge}</span>'
    if not available:
        badge_html = '<span class="pdp-badge pdp-badge--soldout">Sold Out</span>'

    # Build image gallery
    gallery_items = []
    for i, img in enumerate(images):
        img_url = img.get('url', '')
        if not img_url:
            continue
        img_alt = escape(img.get('altText') or title)
        # Full-size for gallery display
        gallery_url = img_url + ('&width=800' if '?' in img_url else '?width=800')
        thumb_url = img_url + ('&width=150' if '?' in img_url else '?width=150')
        active_class = ' active' if i == 0 else ''
        gallery_items.append(
            f'<button class="pdp-thumb{active_class}" data-index="{i}" aria-label="View image {i+1}">'
            f'<img src="{thumb_url}" alt="{img_alt}" width="150" height="150" loading="lazy">'
            f'</button>'
        )

    thumbs_html = '\n            '.join(gallery_items) if gallery_items else ''
    thumbs_section = ''
    if len(gallery_items) > 1:
        thumbs_section = f'''
          <div class="pdp-thumbs">
            {thumbs_html}
          </div>'''

    # Main image
    main_img_url = ''
    main_img_alt = title
    if images:
        main_img_url = images[0].get('url', '')
        main_img_alt = escape(images[0].get('altText') or title)
        if main_img_url:
            main_img_url += '&width=800' if '?' in main_img_url else '?width=800'

    # Build all image URLs for JS gallery data
    all_img_urls_json = json.dumps([
        (img.get('url', '') + ('&width=800' if '?' in img.get('url', '') else '?width=800'))
        for img in images if img.get('url')
    ])

    # CTA
    if is_custom:
        # Always use myshopify.com domain — custom domain will point to GH Pages after DNS migration
        shopify_url = f'https://{SHOPIFY_DOMAIN}/products/{handle}'
        cta_html = f'<a href="{escape(shopify_url)}" class="btn btn-primary btn-lg pdp-cta" target="_blank" rel="noopener">Customize &amp; Order →</a>'
    elif not available:
        cta_html = f'<button class="btn btn-primary btn-lg pdp-cta" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" disabled>Sold Out</button>'
    else:
        cta_html = f'<button class="btn btn-primary btn-lg pdp-cta" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" aria-label="Add {title} to cart">Add to Cart</button>'

    # Related products (same category, excluding self, max 4)
    related = [p for p in all_products if p.get('id') != product_id and get_category(p) == category]
    if len(related) < 4:
        # Fill with other products
        other = [p for p in all_products if p.get('id') != product_id and p not in related]
        related.extend(other[:4 - len(related)])
    related = related[:4]

    related_cards = []
    for rp in related:
        rp_title = escape(rp.get('title', ''))
        rp_handle = rp.get('handle', '')
        rp_price = format_price(rp)
        rp_img_url = get_image_url(rp, 400)
        rp_img_alt = get_image_alt(rp)
        related_cards.append(f'''        <a href="/shop/{rp_handle}/" class="related-card">
          <div class="related-card-image">
            <img src="{rp_img_url}" alt="{rp_img_alt}" width="400" height="400" loading="lazy">
          </div>
          <h4 class="related-card-title">{rp_title}</h4>
          <p class="related-card-price">{rp_price}</p>
        </a>''')

    related_html = '\n\n'.join(related_cards)

    # JSON-LD for individual product
    jsonld_images = [
        (img.get('url', '') + ('&width=1200' if '?' in img.get('url', '') else '?width=1200'))
        for img in images if img.get('url')
    ]
    product_jsonld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': product.get('title', ''),
        'description': description_text,
        'image': jsonld_images if len(jsonld_images) > 1 else (jsonld_images[0] if jsonld_images else ''),
        'url': f'https://magnetmomentsco.us/shop/{handle}/',
        'brand': {
            '@type': 'Brand',
            'name': 'Magnet Moments Co.'
        },
        'offers': {
            '@type': 'Offer',
            'price': min_price,
            'priceCurrency': currency,
            'availability': 'https://schema.org/InStock' if available else 'https://schema.org/OutOfStock',
            'url': f'https://magnetmomentsco.us/shop/{handle}/',
            'seller': {
                '@type': 'Organization',
                'name': 'Magnet Moments Co.'
            }
        }
    }
    jsonld_str = json.dumps(product_jsonld, indent=2).replace('\n', '\n  ')

    # Variant info for products with multiple variants
    variants = product.get('variants', {}).get('nodes', [])
    variant_section = ''
    if len(variants) > 1:
        variant_options = []
        for v in variants:
            v_title = escape(v.get('title', ''))
            v_price = float(v.get('price', {}).get('amount', '0'))
            v_id = escape(v.get('id', ''))
            v_avail = v.get('availableForSale', True)
            disabled = ' disabled' if not v_avail else ''
            checked = ' checked' if v == variants[0] else ''
            variant_options.append(
                f'<label class="pdp-variant-option">'
                f'<input type="radio" name="variant" value="{v_id}" data-price="${v_price:.2f}"{checked}{disabled}>'
                f'<span>{v_title} — ${v_price:.2f}</span>'
                f'</label>'
            )
        variant_section = '<div class="pdp-variants">\n            <h3 class="pdp-variants-label">Options</h3>\n            ' + '\n            '.join(variant_options) + '\n          </div>'

    # Description fallback
    if not description_html:
        description_html = f'<p>{escape(description_text)}</p>' if description_text else '<p>Handcrafted magnet set by Magnet Moments Co.</p>'

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Favicon -->
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/assets/images/favicon.svg" type="image/svg+xml">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/images/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/images/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/images/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#C77D8A">
  <title>{seo_title} — Magnet Moments Co.</title>
  <meta name="description" content="{seo_description}">
  <meta name="keywords" content="{title}, custom magnets, photo magnets, gifts for him, gifts for her, gifts for family, unique gifts, fridge magnets, promotional magnets, business swag, corporate gifts, branded magnets, ships nationwide USA">
  <link rel="canonical" href="https://magnetmomentsco.us/shop/{handle}/">
  <meta property="og:type" content="product">
  <meta property="og:title" content="{seo_title} — Magnet Moments Co.">
  <meta property="og:description" content="{seo_description}">
  <meta property="og:url" content="https://magnetmomentsco.us/shop/{handle}/">
  <meta property="og:image" content="{og_image}">
  <meta property="product:price:amount" content="{min_price}">
  <meta property="product:price:currency" content="{currency}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="google-site-verification" content="3Z2hasokVTsbgwJ4dRizZr9Yw7YAiFiiFErT4mAAnBo">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/style.css">
  <script type="application/ld+json">
  {jsonld_str}
  </script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-GNPEVFLK33"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-GNPEVFLK33');gtag('config','AW-17841486556');</script>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <!-- NAVBAR -->
  <nav class="navbar" role="navigation" aria-label="Main navigation">
    <div class="container">
      <a href="/" class="nav-logo">Magnet <span>Moments</span> Co.</a>
      <div class="nav-links" id="nav-links">
        <a href="/shop/">Shop</a>
        <a href="/events/">Events</a>
        <a href="/wholesale/">Wholesale</a>
        <a href="/about/">About</a>
        <a href="/faq/">FAQ</a>
        <a href="/contact/">Contact</a>
        <a href="https://magnetmomentsco.goaffpro.com/" target="_blank" rel="noopener">Affiliates</a>
        <a href="/shop/" class="btn btn-primary btn-sm nav-cta">Shop Now</a>
        <button class="cart-toggle" aria-label="Shopping cart">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          <span class="cart-count cart-badge" style="display:none;">0</span>
        </button>
      </div>
      <button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation" aria-expanded="false"><span></span><span></span><span></span></button>
    </div>
  </nav>
  <div class="nav-overlay" id="nav-overlay"></div>

  <main id="main-content">

  <!-- BREADCRUMB -->
  <header class="page-header page-header--compact">
    <div class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span class="separator">/</span>
        <a href="/shop/">Shop</a>
        <span class="separator">/</span>
        <span>{title}</span>
      </nav>
    </div>
  </header>

  <!-- PRODUCT DETAIL -->
  <section class="pdp" data-product-id="{escape(product_id)}">
    <div class="container">
      <div class="pdp-layout">

        <!-- Gallery -->
        <div class="pdp-gallery">
          {badge_html}
          <div class="pdp-main-image">
            <img id="pdp-main-img" src="{main_img_url}" alt="{main_img_alt}" width="800" height="800">
          </div>{thumbs_section}
        </div>

        <!-- Info -->
        <div class="pdp-info">
          <h1 class="pdp-title">{title}</h1>
          <p class="pdp-price" data-product-id="{escape(product_id)}">{price_html}</p>

          {variant_section}

          {cta_html}

          <div class="pdp-description">
            {description_html}
          </div>

          <div class="pdp-features">
            <div class="pdp-feature">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
              <span>Ships nationwide across the USA</span>
            </div>
            <div class="pdp-feature">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              <span>Free shipping on orders $35+</span>
            </div>
            <div class="pdp-feature">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>Perfect gift for him, her & family</span>
            </div>
            <div class="pdp-feature">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Handcrafted with love in Austin, TX</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- RELATED PRODUCTS -->
  <section class="related-products">
    <div class="container">
      <h2 class="section-title">You May Also Like</h2>
      <div class="related-grid">
{related_html}
      </div>
      <div style="text-align:center;margin-top:2rem;">
        <a href="/shop/" class="btn btn-secondary">View All Products →</a>
      </div>
    </div>
  </section>

  </main>

  <footer class="footer" role="contentinfo">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="nav-logo">Magnet <span>Moments</span> Co.</a>
          <p>Turning your favorite moments into keepsakes that stick. Handcrafted with love in Austin, Texas.</p>
          <div class="footer-social">
            <a href="https://www.facebook.com/people/Magnet-Moments-Co/61584180085647/" target="_blank" rel="noopener" aria-label="Facebook"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg></a>
            <a href="https://www.instagram.com/magnet_momentsco" target="_blank" rel="noopener" aria-label="Instagram"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg></a>
            <a href="https://www.tiktok.com/@magnetmomentscoshop" target="_blank" rel="noopener" aria-label="TikTok"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.94a8.27 8.27 0 0 0 3.76.92V6.69z"/></svg></a>
          </div>
        </div>
        <div class="footer-col"><h4>Shop</h4><ul><li><a href="/shop/">All Products</a></li><li><a href="https://dbx3hf-qe.myshopify.com/products/custom-photo-magnets" target="_blank" rel="noopener">Custom Photo Magnets</a></li><li><a href="/wholesale/">Wholesale / Bulk</a></li></ul></div>
        <div class="footer-col"><h4>Company</h4><ul><li><a href="/about/">About Us</a></li><li><a href="/events/">Event Services</a></li><li><a href="/faq/">FAQ</a></li><li><a href="/contact/">Contact Us</a></li><li><a href="https://magnetmomentsco.goaffpro.com/" target="_blank" rel="noopener">Affiliates</a></li></ul></div>
        <div class="footer-col"><h4>Policies</h4><ul><li><a href="/policies/shipping/">Shipping</a></li><li><a href="/policies/refund/">Refund</a></li><li><a href="/policies/terms/">Terms</a></li><li><a href="/policies/privacy/">Privacy</a></li></ul></div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2026 Magnet Moments Co. All rights reserved.</p>
        <div class="footer-bottom-links"><a href="/policies/terms/">Terms</a><a href="/policies/privacy/">Privacy</a><a href="mailto:alyssa@magnetmomentsco.us">alyssa@magnetmomentsco.us</a></div>
      </div>
      <p class="footer-credit">Designed by <a href="https://ajayadesign.github.io" target="_blank" rel="noopener">AjayaDesign</a> <a href="/admin/" class="admin-gear" title="Admin" aria-label="Admin"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 6 0Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg></a></p>
    </div>
  </footer>

  <button class="back-to-top" aria-label="Back to top"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 15l-6-6-6 6"/></svg></button>

  <script src="/assets/js/main.js"></script>

  <!-- Image gallery -->
  <script>
  (function() {{
    var images = {all_img_urls_json};
    var mainImg = document.getElementById('pdp-main-img');
    var thumbs = document.querySelectorAll('.pdp-thumb');
    if (thumbs.length > 1 && mainImg) {{
      thumbs.forEach(function(thumb) {{
        thumb.addEventListener('click', function() {{
          var idx = parseInt(this.getAttribute('data-index'), 10);
          if (images[idx]) {{
            mainImg.src = images[idx];
            mainImg.alt = this.querySelector('img').alt;
            thumbs.forEach(function(t) {{ t.classList.remove('active'); }});
            this.classList.add('active');
          }}
        }});
      }});
    }}
  }})();
  </script>

  <!-- Variant selector -->
  <script>
  (function() {{
    var radios = document.querySelectorAll('input[name="variant"]');
    var ctaBtn = document.querySelector('.pdp-cta[data-variant-id]');
    if (radios.length > 1 && ctaBtn) {{
      radios.forEach(function(radio) {{
        radio.addEventListener('change', function() {{
          ctaBtn.setAttribute('data-variant-id', this.value);
          var priceEl = document.querySelector('.pdp-price');
          if (priceEl && this.dataset.price) {{
            priceEl.textContent = this.dataset.price;
          }}
        }});
      }});
    }}
  }})();
  </script>

  <!-- ========== CART DRAWER ========== -->
  <div id="cart-overlay"></div>
  <aside id="cart-drawer" aria-label="Shopping cart" role="dialog" aria-modal="true">
    <div class="cart-drawer-header">
      <h3>Your Cart</h3>
      <button class="cart-close" aria-label="Close cart">
        <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div id="cart-items"></div>
    <div id="cart-empty">
      <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
      <p>Your cart is empty</p>
      <a href="/shop/" class="btn btn-primary btn-sm">Start Shopping</a>
    </div>
    <div id="cart-footer">
      <div class="cart-subtotal-row">
        <span class="cart-subtotal-label">Subtotal</span>
        <span id="cart-subtotal">$0.00</span>
      </div>
      <p class="cart-note">Shipping & taxes calculated at checkout</p>
      <a id="cart-checkout-btn" href="#" target="_blank" rel="noopener">Checkout →</a>
    </div>
  </aside>
  <script src="/assets/js/shopify-cart.js"></script>
  <script src="/assets/js/products.js"></script>
  <script src="/assets/js/mm-tracker.js" defer></script>
</body>
</html>'''


def build_jsonld_products(products):
    """Build JSON-LD Product structured data for SEO."""
    items = []
    for p in products:
        pr = p.get('priceRange', {})
        min_price = pr.get('minVariantPrice', {}).get('amount', '0')
        currency = pr.get('minVariantPrice', {}).get('currencyCode', 'USD')
        image_url = get_image_url(p, 1200)
        available = p.get('availableForSale', True)

        item = {
            '@type': 'Product',
            'name': p.get('title', ''),
            'description': p.get('description', ''),
            'image': image_url,
            'url': f"https://magnetmomentsco.us/shop/{p.get('handle', '')}/",
            'brand': {
                '@type': 'Brand',
                'name': 'Magnet Moments Co.'
            },
            'offers': {
                '@type': 'Offer',
                'price': min_price,
                'priceCurrency': currency,
                'availability': 'https://schema.org/InStock' if available else 'https://schema.org/OutOfStock',
                'seller': {
                    '@type': 'Organization',
                    'name': 'Magnet Moments Co.'
                }
            }
        }
        items.append(item)

    return {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        'name': 'Magnet Moments Co. Products',
        'numberOfItems': len(items),
        'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'item': item}
            for i, item in enumerate(items)
        ]
    }


def inject_into_html(filepath, start_marker, end_marker, new_content):
    """Replace content between markers in an HTML file."""
    with open(filepath, 'r') as f:
        html = f.read()

    if start_marker not in html or end_marker not in html:
        print(f'  ⚠ Markers not found in {filepath}: {start_marker}...{end_marker}')
        return False

    start_idx = html.index(start_marker) + len(start_marker)
    end_idx = html.index(end_marker)
    html = html[:start_idx] + '\n' + new_content + '\n        ' + html[end_idx:]

    with open(filepath, 'w') as f:
        f.write(html)

    print(f'  ✓ Updated {filepath}')
    return True


def inject_jsonld(filepath, new_jsonld_str):
    """Replace or insert JSON-LD Product data in an HTML file."""
    with open(filepath, 'r') as f:
        html = f.read()

    marker_start = '<!-- PRODUCTS_JSONLD_START -->'
    marker_end = '<!-- PRODUCTS_JSONLD_END -->'

    if marker_start in html:
        # Find the markers and replace everything between them
        start_idx = html.index(marker_start)
        end_idx = html.index(marker_end) + len(marker_end)
        html = html[:start_idx] + marker_start + '\n  ' + new_jsonld_str + '\n  ' + marker_end + html[end_idx:]
    else:
        # Insert before </head>
        insertion = f'  {marker_start}\n  {new_jsonld_str}\n  {marker_end}\n'
        html = html.replace('</head>', insertion + '</head>')

    with open(filepath, 'w') as f:
        f.write(html)

    print(f'  ✓ Updated JSON-LD in {filepath}')


def generate_product_pages(products):
    """Generate individual product detail pages for SEO."""
    print('\nGenerating product detail pages...')
    shop_dir = os.path.join(REPO_ROOT, 'shop')
    generated = 0

    # Collect current product handles
    current_handles = set()

    for product in products:
        handle = product.get('handle', '')
        if not handle:
            continue
        current_handles.add(handle)

        page_dir = os.path.join(shop_dir, handle)
        page_file = os.path.join(page_dir, 'index.html')
        os.makedirs(page_dir, exist_ok=True)

        html = build_product_page_html(product, products)
        with open(page_file, 'w') as f:
            f.write(html)

        generated += 1
        print(f'  ✓ /shop/{handle}/index.html')

    # Clean up stale PDP pages for products no longer in Shopify
    removed = 0
    for entry in os.listdir(shop_dir):
        entry_path = os.path.join(shop_dir, entry)
        # Only consider directories that contain an index.html (PDP pages)
        # Skip the shop index.html itself and non-directory entries
        if not os.path.isdir(entry_path):
            continue
        if entry in current_handles:
            continue
        pdp_file = os.path.join(entry_path, 'index.html')
        if os.path.exists(pdp_file):
            import shutil
            shutil.rmtree(entry_path)
            removed += 1
            print(f'  🗑 Removed stale /shop/{entry}/')

    print(f'  Generated {generated} product pages')
    if removed:
        print(f'  Cleaned up {removed} stale product page(s)')
    return generated


def update_shop_page(products):
    """Update the shop page with all products."""
    print('\nUpdating shop page...')

    # Build all product cards
    cards = []
    for p in products:
        cards.append(build_product_card(p, is_shop_page=True))

    cards_html = '\n\n'.join(cards)

    inject_into_html(
        SHOP_HTML,
        '<!-- PRODUCTS_START -->',
        '<!-- PRODUCTS_END -->',
        cards_html
    )

    # JSON-LD
    jsonld = build_jsonld_products(products)
    jsonld_str = '<script type="application/ld+json">\n  ' + json.dumps(jsonld, indent=2).replace('\n', '\n  ') + '\n  </script>'
    inject_jsonld(SHOP_HTML, jsonld_str)


def update_home_page(products):
    """Update the home page with featured products."""
    print('\nUpdating home page...')

    # Featured = products tagged 'featured', or first 6 if no featured tags
    featured = [p for p in products if 'featured' in [t.lower() for t in p.get('tags', [])]]
    if not featured:
        # Fallback: first 6 products
        featured = products[:6]
    else:
        featured = featured[:6]  # Cap at 6

    print(f'  {len(featured)} featured products')

    cards = []
    for p in featured:
        cards.append(build_product_card(p, is_shop_page=False))

    cards_html = '\n\n'.join(cards)

    inject_into_html(
        HOME_HTML,
        '<!-- FEATURED_START -->',
        '<!-- FEATURED_END -->',
        cards_html
    )

    # JSON-LD (featured only)
    jsonld = build_jsonld_products(featured)
    jsonld_str = '<script type="application/ld+json">\n  ' + json.dumps(jsonld, indent=2).replace('\n', '\n  ') + '\n  </script>'
    inject_jsonld(HOME_HTML, jsonld_str)


def main():
    print('=' * 50)
    print('Shopify Product Sync — Magnet Moments Co.')
    print('=' * 50)

    # 1. Fetch from Shopify
    products = fetch_products()

    if not products:
        print('No products found! Skipping update.')
        sys.exit(0)

    # 2. Save JSON data
    save_json(products)

    # 3. Generate individual product pages (SEO)
    generate_product_pages(products)

    # 4. Update shop page
    update_shop_page(products)

    # 5. Update home page
    update_home_page(products)

    print('\n✅ Sync complete!')
    print(f'   Products: {len(products)}')
    print(f'   Data: {DATA_FILE}')
    print(f'   Shop: {SHOP_HTML}')
    print(f'   Home: {HOME_HTML}')
    print(f'   Product pages: /shop/<handle>/index.html')


if __name__ == '__main__':
    main()
