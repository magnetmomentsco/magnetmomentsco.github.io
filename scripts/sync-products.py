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
      productType
      tags
      availableForSale
      totalInventory
      onlineStoreUrl
      createdAt
      updatedAt
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
      images(first: 5) {
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
    Detected by title containing 'Custom Photo' (e.g., '2x2 Custom Photo Magnets').
    """
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
        shopify_url = product.get('onlineStoreUrl') or f'https://{SHOPIFY_DOMAIN}/products/{handle}'
        cta = f'<a href="{escape(shopify_url)}" class="product-card-btn" target="_blank" rel="noopener">View &amp; Customize →</a>'
    elif not available:
        cta = f'<button class="product-card-btn" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" aria-label="Add {title} to cart" disabled>Sold Out</button>'
    else:
        cta = f'<button class="product-card-btn" data-variant-id="{escape(variant_id)}" data-original-text="Add to Cart" aria-label="Add {title} to cart">Add to Cart</button>'

    return f"""        <div class="product-card{sold_out_class}" data-product-id="{escape(product_id)}"{cat_attr}>
          <div class="product-card-image">
            <img src="{image_url}" alt="{image_alt}" width="600" height="600" loading="lazy">{badge_html}
          </div>
          <div class="product-card-body">
            <h3 class="product-card-title">{title}</h3>
            <p class="product-card-price">{price_html}</p>
            {cta}
          </div>
        </div>"""


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
            'url': f"https://magnetmomentsco.us/shop/",
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

    # 3. Update shop page
    update_shop_page(products)

    # 4. Update home page
    update_home_page(products)

    print('\n✅ Sync complete!')
    print(f'   Products: {len(products)}')
    print(f'   Data: {DATA_FILE}')
    print(f'   Shop: {SHOP_HTML}')
    print(f'   Home: {HOME_HTML}')


if __name__ == '__main__':
    main()
