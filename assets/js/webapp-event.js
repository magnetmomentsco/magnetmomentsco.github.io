/**
 * Magnet Moments Co. — Event Mode Logic
 * Guest photo capture/upload for events
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    eventId: null,
    eventData: null,
    uploadCount: 0,
    uploading: false
  };

  // ── DOM References ─────────────────────────────────────────────────────────
  var els = {};
  var pendingDataUrl = null; // Holds captured photo until user confirms

  function init() {
    // Cache DOM
    els.loadingView = document.getElementById('loading-view');
    els.mainView = document.getElementById('main-view');
    els.errorView = document.getElementById('error-view');
    els.eventName = document.getElementById('event-name');
    els.eventSubtitle = document.getElementById('event-subtitle');
    els.uploadCounter = document.getElementById('upload-counter');
    els.countNumber = document.getElementById('count-number');
    els.takePhotoBtn = document.getElementById('take-photo-btn');
    els.uploadPhotoBtn = document.getElementById('upload-photo-btn');
    els.fileInput = document.getElementById('file-input');
    els.cameraContainer = document.getElementById('camera-container');
    els.cameraVideo = document.getElementById('camera-video');
    els.snapBtn = document.getElementById('snap-btn');
    els.cameraSwitchBtn = document.getElementById('camera-switch-btn');
    els.cameraCloseBtn = document.getElementById('camera-close-btn');
    els.photoGrid = document.getElementById('photo-grid');
    els.uploadStatus = document.getElementById('upload-status');
    els.statusText = document.getElementById('status-text');
    els.cameraCanvas = document.getElementById('camera-canvas');
    els.cameraControls = document.getElementById('camera-controls');
    els.cameraReview = document.getElementById('camera-review');
    els.retakeBtn = document.getElementById('retake-btn');
    els.usePhotoBtn = document.getElementById('use-photo-btn');

    // Get event ID from URL
    var params = new URLSearchParams(window.location.search);
    state.eventId = params.get('id');

    if (!state.eventId) {
      showError('No Event Found', 'Please scan the QR code provided at the event.');
      return;
    }

    // Load event data from Firebase
    loadEvent();

    // Bind events
    bindCamera();
    bindFileUpload();

    // Global keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        // Close preview overlay
        var overlay = document.querySelector('.photo-preview-overlay');
        if (overlay) { overlay.remove(); return; }
        // Close camera
        if (els.cameraContainer.classList.contains('active')) { closeCamera(); }
      }
    });
  }

  // ── Event Loading ──────────────────────────────────────────────────────────
  function loadEvent() {
    showLoading();

    MMWebapp.fb.get('events/' + state.eventId)
      .then(function (eventData) {
        if (!eventData) {
          showError('Event Not Found', 'This event may have ended or the link is invalid.');
          return;
        }

        if (!eventData.active) {
          showError('Event Ended', 'This event has concluded. Thanks for participating!');
          return;
        }

        state.eventData = eventData;
        showMainView();

        // Display event info
        els.eventName.textContent = eventData.name;
        els.eventSubtitle.textContent = 'Share your best moments!';

        // Listen for live photo count
        MMWebapp.fb.listen('events/' + state.eventId + '/photoCount', function (count) {
          state.uploadCount = count || 0;
          updateCounter();
        });
      })
      .catch(function (err) {
        console.error('Event load error:', err);
        showError('Connection Error', 'Unable to load event. Please check your connection and try again.');
      });
  }

  // ── View Management ────────────────────────────────────────────────────────
  function showLoading() {
    els.loadingView.classList.remove('hidden');
    els.mainView.classList.add('hidden');
    els.errorView.classList.add('hidden');
  }

  function showMainView() {
    els.loadingView.classList.add('hidden');
    els.mainView.classList.remove('hidden');
    els.errorView.classList.add('hidden');
  }

  function showError(title, message) {
    els.loadingView.classList.add('hidden');
    els.mainView.classList.add('hidden');
    els.errorView.classList.remove('hidden');
    els.errorView.querySelector('h2').textContent = title;
    els.errorView.querySelector('p').textContent = message;
  }

  // ── Upload Counter ─────────────────────────────────────────────────────────
  function updateCounter() {
    els.countNumber.textContent = state.uploadCount;
    els.uploadCounter.style.display = state.uploadCount > 0 ? 'flex' : 'none';
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function bindCamera() {
    els.takePhotoBtn.addEventListener('click', openCamera);

    els.snapBtn.addEventListener('click', function () {
      pendingDataUrl = MMWebapp.capturePhoto(els.cameraVideo);
      // Flash effect
      els.cameraContainer.style.opacity = '0.5';
      setTimeout(function () { els.cameraContainer.style.opacity = '1'; }, 100);
      // Show preview on canvas
      showReview(pendingDataUrl);
    });

    els.retakeBtn.addEventListener('click', function () {
      pendingDataUrl = null;
      hideReview();
    });

    els.usePhotoBtn.addEventListener('click', function () {
      if (pendingDataUrl) {
        uploadEventPhoto(pendingDataUrl);
        MMWebapp.showToast('Photo captured! Take another or close camera.', 'success', 2000);
      }
      pendingDataUrl = null;
      hideReview();
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
      console.error('Camera error:', err.name, err.message);
      els.cameraContainer.classList.remove('active');
      var msg = (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        ? 'Camera access denied. Opening photo upload…'
        : 'Camera error: ' + err.message + '. Opening photo upload…';
      MMWebapp.showToast(msg, 'error', 4000);
      if (els.fileInput) els.fileInput.click();
    });
  }

  function closeCamera() {
    pendingDataUrl = null;
    hideReview();
    MMWebapp.stopCamera();
    els.cameraContainer.classList.remove('active');
  }

  function showReview(dataUrl) {
    // Draw captured frame onto canvas
    var img = new Image();
    img.onload = function () {
      els.cameraCanvas.width = img.width;
      els.cameraCanvas.height = img.height;
      els.cameraCanvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = dataUrl;
    // Swap video for canvas, swap controls for review buttons
    els.cameraVideo.classList.add('hidden');
    els.cameraCanvas.classList.remove('hidden');
    els.cameraControls.classList.add('hidden');
    els.cameraReview.classList.remove('hidden');
  }

  function hideReview() {
    els.cameraCanvas.classList.add('hidden');
    els.cameraVideo.classList.remove('hidden');
    els.cameraReview.classList.add('hidden');
    els.cameraControls.classList.remove('hidden');
  }

  // ── File Upload ────────────────────────────────────────────────────────────
  function bindFileUpload() {
    els.uploadPhotoBtn.addEventListener('click', function () {
      els.fileInput.click();
    });

    els.fileInput.addEventListener('change', function (e) {
      var files = Array.from(e.target.files);
      var pending = files.length;
      if (pending === 0) return;

      showUploadStatus('Processing ' + pending + ' photo' + (pending > 1 ? 's' : '') + '...');

      files.forEach(function (file) {
        if (!file.type.startsWith('image/')) {
          pending--;
          return;
        }
        MMWebapp.compressImage(file).then(function (dataUrl) {
          uploadEventPhoto(dataUrl);
          pending--;
          if (pending <= 0) hideUploadStatus();
        });
      });
      els.fileInput.value = '';
    });
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  function uploadEventPhoto(dataUrl, existingThumb) {
    // Add thumbnail immediately with uploading state (or reuse existing for retries)
    var thumbEl = existingThumb || addPhotoThumb(dataUrl);

    MMWebapp.uploadPhoto(dataUrl, {
      mode: 'event',
      eventFolderId: state.eventData.driveFolderId
    })
    .then(function () {
      // Increment counter in Firebase
      return MMWebapp.fb.increment('events/' + state.eventId + '/photoCount');
    })
    .then(function () {
      // Mark thumbnail as uploaded
      if (thumbEl) thumbEl.classList.add('uploaded');
      if (thumbEl) thumbEl.classList.remove('uploading');
      MMWebapp.showToast('Photo uploaded!', 'success');
    })
    .catch(function (err) {
      console.error('Upload error:', err);
      if (thumbEl) {
        thumbEl.classList.remove('uploading');
        thumbEl.classList.add('upload-failed');
        var retryBtn = thumbEl.querySelector('.retry-upload');
        if (retryBtn) retryBtn.classList.remove('hidden');
      }
      MMWebapp.showToast('Upload failed. Tap photo to retry.', 'error');
    });
  }

  function addPhotoThumb(dataUrl) {
    var thumb = document.createElement('div');
    thumb.className = 'photo-thumb uploading';
    thumb.setAttribute('role', 'listitem');
    thumb.innerHTML = '<img src="' + dataUrl + '" alt="Uploaded photo">' +
      '<div class="thumb-overlay"><div class="thumb-spinner"></div></div>' +
      '<button class="retry-upload hidden" aria-label="Retry upload">↻</button>';
    els.photoGrid.appendChild(thumb);

    // Tap failed thumbnail to retry
    var retryBtn = thumb.querySelector('.retry-upload');
    retryBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      thumb.classList.remove('upload-failed');
      thumb.classList.add('uploading');
      retryBtn.classList.add('hidden');
      uploadEventPhoto(dataUrl, thumb);
    });

    // Tap uploaded thumbnail to expand
    thumb.querySelector('img').addEventListener('click', function () {
      if (thumb.classList.contains('uploaded')) {
        showPhotoPreview(dataUrl);
      }
    });

    // Scroll the grid to show the new thumbnail
    els.photoGrid.scrollLeft = els.photoGrid.scrollWidth;
    return thumb;
  }

  // ── Fullscreen Photo Preview ───────────────────────────────────────────────
  function showPhotoPreview(dataUrl) {
    var overlay = document.createElement('div');
    overlay.className = 'photo-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Photo preview');
    overlay.innerHTML = '<img src="' + dataUrl + '" alt="Photo preview">' +
      '<button class="photo-preview-close" aria-label="Close preview">✕</button>';
    var closeBtn = overlay.querySelector('.photo-preview-close');
    overlay.addEventListener('click', function () { overlay.remove(); });
    closeBtn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') overlay.remove();
    });
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  // ── Upload Status UI ───────────────────────────────────────────────────────
  function showUploadStatus(message) {
    els.uploadStatus.className = 'upload-status active uploading';
    els.statusText.textContent = message;
  }

  function hideUploadStatus() {
    els.uploadStatus.classList.remove('active');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
