/**
 * Magnet Moments Co. — Market Mode Logic
 * Order builder with pricing, tax calculation, payment deep-links
 */
(function () {
  'use strict';

  // ── Pricing Table ──────────────────────────────────────────────────────────
  var PRICES = {
    '2x2': {
      '1':  4.00,
      '3':  12.00,
      '6':  19.00,
      '9':  25.00,
      '12': 30.00
    },
    '2x3': {
      '1':  4.50,
      '3':  13.50,
      '6':  22.00,
      '9':  32.00,
      '12': 40.00
    }
  };

  var TAX_RATE = 0.0825;

  var VENMO_USERNAME = 'magnetmomentsco';
  var PAYPAL_ME_URL = 'https://www.paypal.com/biz/profile/magnetmomentsco';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    size: '2x2',
    quantity: 6,
    photos: [],        // Array of { dataUrl, file? }
    subtotal: 0,
    tax: 0,
    total: 0,
    submitting: false
  };

  // ── DOM References ─────────────────────────────────────────────────────────
  var els = {};

  function init() {
    // Cache DOM elements
    els.sizeButtons = document.querySelectorAll('.size-btn');
    els.quantityOptions = document.querySelectorAll('.quantity-option');
    els.subtotalEl = document.getElementById('subtotal');
    els.taxEl = document.getElementById('tax-amount');
    els.totalEl = document.getElementById('total-amount');
    els.photoGrid = document.getElementById('photo-grid');
    els.photoCount = document.getElementById('photo-count');
    els.takePhotoBtn = document.getElementById('take-photo-btn');
    els.uploadPhotoBtn = document.getElementById('upload-photo-btn');
    els.fileInput = document.getElementById('file-input');
    els.cameraContainer = document.getElementById('camera-container');
    els.cameraVideo = document.getElementById('camera-video');
    els.snapBtn = document.getElementById('snap-btn');
    els.cameraSwitchBtn = document.getElementById('camera-switch-btn');
    els.cameraCloseBtn = document.getElementById('camera-close-btn');
    els.payVenmo = document.getElementById('pay-venmo');
    els.payPaypal = document.getElementById('pay-paypal');

    els.payCash = document.getElementById('pay-cash');
    els.venmoAmount = document.getElementById('venmo-amount');
    els.paypalAmount = document.getElementById('paypal-amount');
    els.uploadStatus = document.getElementById('upload-status');
    els.statusText = document.getElementById('status-text');
    els.orderForm = document.getElementById('order-form');
    els.orderConfirmation = document.getElementById('order-confirmation');

    // Bind events
    bindSizeButtons();
    bindQuantityOptions();
    bindCamera();
    bindFileUpload();
    bindPaymentButtons();

    // New order button
    var newOrderBtn = document.getElementById('new-order-btn');
    if (newOrderBtn) {
      newOrderBtn.addEventListener('click', resetOrder);
    }

    // Initial calculation
    updatePrice();
  }

  // ── Size Selection ─────────────────────────────────────────────────────────
  function bindSizeButtons() {
    els.sizeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        els.sizeButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.size = btn.dataset.size;
        updateQuantityPrices();
        updatePrice();
      });
    });
  }

  // ── Quantity Selection ─────────────────────────────────────────────────────
  function bindQuantityOptions() {
    els.quantityOptions.forEach(function (opt) {
      opt.addEventListener('click', function () {
        selectQuantity(opt);
      });
      opt.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectQuantity(opt);
        }
      });
    });
  }

  function selectQuantity(opt) {
    els.quantityOptions.forEach(function (o) {
      o.classList.remove('active');
      o.setAttribute('aria-checked', 'false');
    });
    opt.classList.add('active');
    opt.setAttribute('aria-checked', 'true');
    state.quantity = parseInt(opt.dataset.qty, 10) || 1;
    updatePrice();
  }

  function updateQuantityPrices() {
    var sizePrices = PRICES[state.size];
    els.quantityOptions.forEach(function (opt) {
      var qty = opt.dataset.qty;
      var priceEl = opt.querySelector('.qty-price');
      if (priceEl && sizePrices[qty] !== undefined) {
        priceEl.textContent = MMWebapp.formatCurrency(sizePrices[qty]);
      }
    });
  }

  // ── Price Calculation ──────────────────────────────────────────────────────
  function updatePrice() {
    var price = PRICES[state.size][String(state.quantity)];
    if (price === undefined) return;

    state.subtotal = price;
    state.tax = Math.round(price * TAX_RATE * 100) / 100;
    state.total = Math.round((state.subtotal + state.tax) * 100) / 100;

    // Animate value change
    animateValue(els.subtotalEl, state.subtotal);
    animateValue(els.taxEl, state.tax);
    animateValue(els.totalEl, state.total);

    // Update payment button amounts
    if (els.venmoAmount) els.venmoAmount.textContent = MMWebapp.formatCurrency(state.total);
    if (els.paypalAmount) els.paypalAmount.textContent = MMWebapp.formatCurrency(state.total);
  }

  function animateValue(el, newValue) {
    var formatted = MMWebapp.formatCurrency(newValue);
    if (el.textContent === formatted) return;
    el.style.transition = 'none';
    el.style.transform = 'scale(1.1)';
    el.style.color = 'var(--color-primary)';
    el.textContent = formatted;
    requestAnimationFrame(function () {
      el.style.transition = 'transform 0.3s ease, color 0.3s ease';
      el.style.transform = 'scale(1)';
      el.style.color = '';
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function bindCamera() {
    els.takePhotoBtn.addEventListener('click', openCamera);

    els.snapBtn.addEventListener('click', function () {
      var dataUrl = MMWebapp.capturePhoto(els.cameraVideo);
      addPhoto(dataUrl);
      MMWebapp.showToast('Photo captured!', 'success');
    });

    els.cameraSwitchBtn.addEventListener('click', function () {
      MMWebapp.switchCamera(els.cameraVideo).catch(function () {
        MMWebapp.showToast('Could not switch camera', 'error');
      });
    });

    els.cameraCloseBtn.addEventListener('click', closeCamera);
  }

  function openCamera() {
    els.cameraContainer.classList.add('active');
    MMWebapp.startCamera(els.cameraVideo).catch(function (err) {
      console.error('Camera error:', err);
      els.cameraContainer.classList.remove('active');
      MMWebapp.showToast('Camera access denied. Try uploading instead.', 'error', 4000);
    });
  }

  function closeCamera() {
    MMWebapp.stopCamera();
    els.cameraContainer.classList.remove('active');
  }

  // ── File Upload ────────────────────────────────────────────────────────────
  function bindFileUpload() {
    els.uploadPhotoBtn.addEventListener('click', function () {
      els.fileInput.click();
    });

    els.fileInput.addEventListener('change', function (e) {
      var files = Array.from(e.target.files);
      files.forEach(function (file) {
        if (!file.type.startsWith('image/')) return;
        MMWebapp.compressImage(file).then(function (dataUrl) {
          addPhoto(dataUrl);
        });
      });
      // Reset input so same file can be selected again
      els.fileInput.value = '';
    });
  }

  // ── Photo Management ───────────────────────────────────────────────────────
  function addPhoto(dataUrl) {
    state.photos.push({ dataUrl: dataUrl });
    renderPhotos();
  }

  function removePhoto(index) {
    state.photos.splice(index, 1);
    renderPhotos();
  }

  function renderPhotos() {
    els.photoGrid.innerHTML = '';
    state.photos.forEach(function (photo, i) {
      var thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.setAttribute('role', 'listitem');
      thumb.innerHTML =
        '<img src="' + photo.dataUrl + '" alt="Photo ' + (i + 1) + '">' +
        '<button class="remove-photo" data-index="' + i + '" aria-label="Remove photo ' + (i + 1) + '">&times;</button>';
      els.photoGrid.appendChild(thumb);
    });

    // Bind remove buttons
    els.photoGrid.querySelectorAll('.remove-photo').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removePhoto(parseInt(btn.dataset.index, 10));
      });
    });

    // Update count with quantity guidance
    var count = state.photos.length;
    var qty = parseInt(state.quantity, 10);
    if (count > 0) {
      var text = count + ' photo' + (count > 1 ? 's' : '') + ' ready';
      if (count < qty) {
        text += ' (add ' + (qty - count) + ' more for your set)';
      } else if (count > qty) {
        text += ' — we\'ll use the best ' + qty;
      }
      els.photoCount.textContent = text;
      els.photoCount.style.display = 'block';
    } else {
      els.photoCount.textContent = '';
      els.photoCount.style.display = 'none';
    }
  }

  // ── Payment ────────────────────────────────────────────────────────────────
  function bindPaymentButtons() {
    els.payVenmo.addEventListener('click', function (e) {
      e.preventDefault();
      if (!validateOrder()) return;
      processOrder('venmo');
    });

    els.payPaypal.addEventListener('click', function (e) {
      e.preventDefault();
      if (!validateOrder()) return;
      processOrder('paypal');
    });

    els.payCash.addEventListener('click', function (e) {
      e.preventDefault();
      if (!validateOrder()) return;
      processOrder('cash-tap');
    });
  }

  function validateOrder() {
    if (state.submitting) return false;
    if (state.photos.length === 0) {
      MMWebapp.showToast('Please add at least one photo', 'error');
      return false;
    }
    return true;
  }

  function setPaymentButtonsEnabled(enabled) {
    var btns = document.querySelectorAll('.pay-btn');
    btns.forEach(function (btn) {
      if (enabled) {
        btn.classList.remove('disabled');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
      } else {
        btn.classList.add('disabled');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.5';
      }
    });
  }

  function processOrder(paymentMethod) {
    state.submitting = true;
    setPaymentButtonsEnabled(false);
    showUploadStatus('Uploading your photos...');

    var orderId = MMWebapp.generateOrderId();
    var uploaded = 0;
    var total = state.photos.length;

    var uploadPromises = state.photos.map(function (photo) {
      return MMWebapp.uploadPhoto(photo.dataUrl, {
        mode: 'market',
        paymentMethod: paymentMethod,
        orderId: orderId
      }).then(function (result) {
        uploaded++;
        showUploadStatus('Uploading... ' + uploaded + '/' + total);
        return result;
      });
    });

    var fileIds = [];
    Promise.all(uploadPromises)
      .then(function (results) {
        fileIds = results.map(function (r) { return r && r.fileId || null; }).filter(Boolean);
        showUploadStatus('Saving order...');
        // Save order to Firebase — all orders start pending; admin confirms payment
        return MMWebapp.fb.push('orders', {
          orderId: orderId,
          sessionDate: MMWebapp.getTodayString(),
          size: state.size,
          quantity: state.quantity,
          subtotal: state.subtotal,
          tax: state.tax,
          total: state.total,
          paymentMethod: paymentMethod,
          paymentStatus: 'pending',
          photoCount: state.photos.length,
          driveFileIds: fileIds,
          timestamp: Date.now()
        });
      })
      .then(function () {
        // Update market session stats (best-effort, non-blocking)
        var sessionPath = 'market-sessions/' + MMWebapp.getTodayString();
        MMWebapp.fb.get(sessionPath).then(function (session) {
          var updates = {};
          updates['orderCount'] = (session && session.orderCount || 0) + 1;
          updates['revenue/subtotal'] = Math.round(((session && session.revenue && session.revenue.subtotal || 0) + state.subtotal) * 100) / 100;
          updates['revenue/tax'] = Math.round(((session && session.revenue && session.revenue.tax || 0) + state.tax) * 100) / 100;
          updates['revenue/total'] = Math.round(((session && session.revenue && session.revenue.total || 0) + state.total) * 100) / 100;
          var pmKey = 'paymentBreakdown/' + paymentMethod;
          updates[pmKey] = (session && session.paymentBreakdown && session.paymentBreakdown[paymentMethod] || 0) + 1;
          return MMWebapp.fb.update(sessionPath, updates);
        }).catch(function () { /* non-critical */ });
      })
      .then(function () {
        hideUploadStatus();
        state.submitting = false;

        // Open payment link
        openPaymentLink(paymentMethod);

        // Show confirmation screen
        showConfirmation(paymentMethod);
      })
      .catch(function (err) {
        hideUploadStatus();
        state.submitting = false;
        setPaymentButtonsEnabled(true);
        console.error('Order error:', err);
        MMWebapp.showToast('Upload failed. Please try again.', 'error');
      });
  }

  function openPaymentLink(method) {
    var amount = state.total.toFixed(2);
    var note = encodeURIComponent('Magnet Moments Co - ' + state.size + ' x' + state.quantity);

    switch (method) {
      case 'venmo':
        // Venmo deep-link: opens app on mobile, web on desktop
        window.location.href = 'venmo://paycharge?txn=pay&recipients=' +
          encodeURIComponent(VENMO_USERNAME) + '&amount=' + amount + '&note=' + note;
        // Fallback to web after brief delay
        setTimeout(function () {
          window.open('https://venmo.com/u/' + encodeURIComponent(VENMO_USERNAME) +
            '?txn=pay&amount=' + amount + '&note=' + note, '_blank');
        }, 1500);
        break;

      case 'paypal':
        window.open(PAYPAL_ME_URL, '_blank');
        break;

      case 'cash-tap':
        MMWebapp.showToast('Please see a team member to pay', 'info', 5000);
        break;
    }
  }

  // ── Order Confirmation ─────────────────────────────────────────────────────
  function showConfirmation(paymentMethod) {
    if (!els.orderForm || !els.orderConfirmation) return;

    // Populate confirmation details
    var confSize = document.getElementById('conf-size');
    var confQty = document.getElementById('conf-qty');
    var confPhotos = document.getElementById('conf-photos');
    var confTotal = document.getElementById('conf-total');
    var confPayment = document.getElementById('conf-payment');

    var paymentLabels = {
      'venmo': 'Venmo',
      'paypal': 'PayPal',
      'cash-tap': 'Cash / Tap'
    };

    if (confSize) confSize.textContent = state.size;
    if (confQty) confQty.textContent = state.quantity;
    if (confPhotos) confPhotos.textContent = state.photos.length;
    if (confTotal) confTotal.textContent = MMWebapp.formatCurrency(state.total);
    if (confPayment) confPayment.textContent = paymentLabels[paymentMethod] || paymentMethod;

    els.orderForm.classList.add('hidden');
    els.orderConfirmation.classList.remove('hidden');

    // Focus the new order button for accessibility
    var newOrderBtn = document.getElementById('new-order-btn');
    if (newOrderBtn) newOrderBtn.focus();
  }

  function resetOrder() {
    // Reset state
    state.photos = [];
    state.size = '2x2';
    state.quantity = 6;
    state.submitting = false;

    // Reset UI
    els.sizeButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.size === '2x2');
    });
    els.quantityOptions.forEach(function (opt) {
      var isDefault = opt.dataset.qty === '6';
      opt.classList.toggle('active', isDefault);
      opt.setAttribute('aria-checked', isDefault ? 'true' : 'false');
    });
    updateQuantityPrices();
    updatePrice();
    renderPhotos();
    setPaymentButtonsEnabled(true);

    // Switch views
    if (els.orderConfirmation) els.orderConfirmation.classList.add('hidden');
    if (els.orderForm) els.orderForm.classList.remove('hidden');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Upload Status UI ───────────────────────────────────────────────────────
  function showUploadStatus(message) {
    els.uploadStatus.className = 'upload-status active uploading';
    els.statusText.textContent = message;
  }

  function hideUploadStatus() {
    els.uploadStatus.classList.remove('active');
  }

  // ── Init on DOM Ready ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
