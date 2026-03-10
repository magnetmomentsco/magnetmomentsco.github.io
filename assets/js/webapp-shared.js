/**
 * Magnet Moments Co. — Shared Webapp Module
 * Camera capture, photo upload, Google Drive integration, Firebase helpers
 */
(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────────────────────
  // UPDATE THIS after deploying Google Apps Script
  var APPS_SCRIPT_URL = '__APPS_SCRIPT_URL__';

  var FIREBASE_SDK_APP = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
  var FIREBASE_SDK_DB = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js';
  var FIREBASE_CONFIG = {
    apiKey: '__FIREBASE_API_KEY__',
    authDomain: '__FIREBASE_AUTH_DOMAIN__',
    databaseURL: '__FIREBASE_DATABASE_URL__',
    projectId: 'magnetmomentsco-us',
    storageBucket: '__FIREBASE_STORAGE_BUCKET__',
    messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
    appId: '__FIREBASE_APP_ID__'
  };

  var MAX_IMAGE_DIMENSION = 2048;
  var JPEG_QUALITY = 0.85;

  // ── State ──────────────────────────────────────────────────────────────────
  var db = null;
  var firebaseReady = false;
  var cameraStream = null;
  var currentFacingMode = 'environment'; // Back camera default

  // ── Firebase Init ──────────────────────────────────────────────────────────
  function initFirebase(callback) {
    if (firebaseReady) { callback(db); return; }
    loadScript(FIREBASE_SDK_APP, function () {
      loadScript(FIREBASE_SDK_DB, function () {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        db = firebase.database();
        firebaseReady = true;
        callback(db);
      });
    });
  }

  function loadScript(src, cb) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) { cb(); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = cb;
    s.onerror = function () { console.error('Failed to load: ' + src); };
    document.head.appendChild(s);
  }

  // ── Firebase Database Helpers ──────────────────────────────────────────────
  function fbPush(path, data) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        var ref = database.ref(path).push();
        data.id = ref.key;
        ref.set(data)
          .then(function () { resolve(ref.key); })
          .catch(reject);
      });
    });
  }

  function fbSet(path, data) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        database.ref(path).set(data)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  function fbUpdate(path, data) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        database.ref(path).update(data)
          .then(resolve)
          .catch(reject);
      });
    });
  }

  function fbGet(path) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        database.ref(path).once('value')
          .then(function (snap) { resolve(snap.val()); })
          .catch(reject);
      });
    });
  }

  function fbListen(path, callback) {
    initFirebase(function (database) {
      database.ref(path).on('value', function (snap) {
        callback(snap.val());
      });
    });
  }

  function fbIncrement(path) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        var ref = database.ref(path);
        ref.transaction(function (current) {
          return (current || 0) + 1;
        })
        .then(function (result) { resolve(result.snapshot.val()); })
        .catch(reject);
      });
    });
  }

  function fbTransactionAdd(path, amount) {
    return new Promise(function (resolve, reject) {
      initFirebase(function (database) {
        var ref = database.ref(path);
        ref.transaction(function (current) {
          return Math.round(((current || 0) + amount) * 100) / 100;
        })
        .then(function (result) { resolve(result.snapshot.val()); })
        .catch(reject);
      });
    });
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  function startCamera(videoEl, facingMode, useExact) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Camera not supported on this device'));
    }

    facingMode = facingMode || currentFacingMode;
    currentFacingMode = facingMode;

    // Default: preference mode (works on all devices for initial open).
    // Exact mode only used by switchCamera() to force the other lens.
    var constraints = {
      video: {
        facingMode: useExact ? { exact: facingMode } : facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    return navigator.mediaDevices.getUserMedia(constraints)
      .catch(function (err) {
        // If permission denied, no point retrying
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          throw err;
        }
        // Fallback: any camera, no constraints
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      })
      .then(function (stream) {
        cameraStream = stream;
        videoEl.srcObject = stream;
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('autoplay', '');
        videoEl.muted = true;

        // WebKit (Safari) requires explicit play() call
        var playPromise = videoEl.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(function () {
            // Autoplay blocked — user interaction required
            console.warn('Video autoplay blocked, waiting for interaction');
          });
        }
        return playPromise;
      });
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(function (track) { track.stop(); });
      cameraStream = null;
    }
  }

  function switchCamera(videoEl) {
    stopCamera();
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    return startCamera(videoEl, currentFacingMode, true);
  }

  function capturePhoto(videoEl) {
    var canvas = document.createElement('canvas');
    var w = videoEl.videoWidth;
    var h = videoEl.videoHeight;

    // Resize if needed
    if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
      var ratio = Math.min(MAX_IMAGE_DIMENSION / w, MAX_IMAGE_DIMENSION / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  // ── Image Compression ──────────────────────────────────────────────────────
  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      // HEIC/HEIF can't be rendered in browser canvas — just send raw for these
      var isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
                   (file.name && /\.hei[cf]$/i.test(file.name));
      if (isHeic) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      // If file is already small (< 500KB), no compression needed
      if (file.size < 500 * 1024) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      var img = new Image();
      var reader2 = new FileReader();

      reader2.onload = function (e) {
        img.onload = function () {
          var canvas = document.createElement('canvas');
          var w = img.width;
          var h = img.height;

          if (w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION) {
            var ratio = Math.min(MAX_IMAGE_DIMENSION / w, MAX_IMAGE_DIMENSION / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.onerror = function () {
          // If image can't load (corrupted/unsupported), send raw data
          var fallbackReader = new FileReader();
          fallbackReader.onload = function () { resolve(fallbackReader.result); };
          fallbackReader.onerror = reject;
          fallbackReader.readAsDataURL(file);
        };
        img.src = e.target.result;
      };
      reader2.onerror = reject;
      reader2.readAsDataURL(file);
    });
  }

  // ── Upload to Google Apps Script ───────────────────────────────────────────
  var UPLOAD_TIMEOUT = 30000; // 30 seconds
  var MAX_RETRIES = 2;

  function uploadPhoto(photoDataUrl, options) {
    return uploadPhotoWithRetry(photoDataUrl, options, 0);
  }

  function uploadPhotoWithRetry(photoDataUrl, options, attempt) {
    // Extract actual MIME type from data URL prefix (e.g. "data:image/png;base64,...")
    var detectedMime = 'image/jpeg';
    if (typeof photoDataUrl === 'string' && photoDataUrl.indexOf('data:') === 0) {
      var semi = photoDataUrl.indexOf(';');
      if (semi > 5) detectedMime = photoDataUrl.substring(5, semi);
    }
    var payload = {
      action: 'upload',
      photo: photoDataUrl,
      mimeType: detectedMime,
      mode: options.mode,
      date: options.date || getTodayString(),
      paymentMethod: options.paymentMethod || null,
      eventFolderId: options.eventFolderId || null,
      customerName: options.customerName || null,
      customerPhone: options.customerPhone || null
    };

    return fetchWithTimeout(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      redirect: 'follow'
    }, UPLOAD_TIMEOUT)
    .then(function (response) {
      if (!response.ok) {
        throw new Error('Server returned ' + response.status);
      }
      return response.json();
    })
    .then(function (data) {
      if (data && data.success === false) {
        throw new Error(data.error || 'Upload rejected by server');
      }
      return data;
    })
    .catch(function (err) {
      console.warn('Upload attempt ' + (attempt + 1) + ' failed:', err.message);
      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 1s, 2s
        var delay = (attempt + 1) * 1000;
        return new Promise(function (resolve) {
          setTimeout(resolve, delay);
        }).then(function () {
          return uploadPhotoWithRetry(photoDataUrl, options, attempt + 1);
        });
      }
      // Final attempt failed — try no-cors as last resort
      return uploadPhotoNoCors(photoDataUrl, options);
    });
  }

  function uploadPhotoNoCors(photoDataUrl, options) {
    var detectedMime = 'image/jpeg';
    if (typeof photoDataUrl === 'string' && photoDataUrl.indexOf('data:') === 0) {
      var semi = photoDataUrl.indexOf(';');
      if (semi > 5) detectedMime = photoDataUrl.substring(5, semi);
    }
    var payload = {
      action: 'upload',
      photo: photoDataUrl,
      mimeType: detectedMime,
      mode: options.mode,
      date: options.date || getTodayString(),
      paymentMethod: options.paymentMethod || null,
      eventFolderId: options.eventFolderId || null,
      customerName: options.customerName || null,
      customerPhone: options.customerPhone || null
    };

    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      mode: 'no-cors'
    })
    .then(function () {
      // Opaque response — optimistically assume success
      console.info('Upload sent via no-cors fallback');
      return { success: true, fallback: true };
    })
    .catch(function (err) {
      console.error('Upload error (final):', err);
      throw new Error('Upload failed after retries. Check your connection.');
    });
  }

  function fetchWithTimeout(url, options, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller) {
        options.signal = controller.signal;
      }

      var timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error('Upload timed out'));
      }, timeout);

      fetch(url, options)
        .then(function (response) {
          clearTimeout(timer);
          resolve(response);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ── Event API ──────────────────────────────────────────────────────────────
  function createEventFolder(name, date) {
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'create-event',
        name: name,
        date: date
      }),
      redirect: 'follow'
    })
    .then(function (r) { return r.json(); });
  }

  function getEvents() {
    return fetch(APPS_SCRIPT_URL + '?action=get-events', {
      redirect: 'follow'
    })
    .then(function (r) { return r.json(); });
  }

  // ── Offline Upload Queue ───────────────────────────────────────────────────
  var QUEUE_KEY = 'mm_upload_queue';
  var isProcessingQueue = false;

  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.warn('Could not save upload queue to localStorage');
    }
  }

  function queueUpload(photoDataUrl, options) {
    var queue = getQueue();
    queue.push({
      photoDataUrl: photoDataUrl,
      options: options,
      timestamp: Date.now()
    });
    saveQueue(queue);
  }

  function processQueue() {
    if (isProcessingQueue) return;
    if (!navigator.onLine) return;

    var queue = getQueue();
    if (queue.length === 0) return;

    isProcessingQueue = true;
    showToast('Uploading ' + queue.length + ' queued photo' + (queue.length > 1 ? 's' : '') + '...', 'info', 3000);

    function processNext() {
      var queue = getQueue();
      if (queue.length === 0) {
        isProcessingQueue = false;
        showToast('All queued photos uploaded!', 'success');
        return;
      }

      var item = queue[0];
      uploadPhoto(item.photoDataUrl, item.options)
        .then(function () {
          // Remove from queue on success
          var q = getQueue();
          q.shift();
          saveQueue(q);
          processNext();
        })
        .catch(function () {
          // Stop processing on failure — try again later
          isProcessingQueue = false;
        });
    }

    processNext();
  }

  // Listen for connectivity changes
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      setTimeout(processQueue, 1000);
    });
    // Try processing queue on init
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(processQueue, 2000);
      });
    } else {
      setTimeout(processQueue, 2000);
    }
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  function getTodayString() {
    var d = new Date();
    var year = d.getFullYear();
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration);
  }

  function generateOrderId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).substring(2, 6);
    return 'ord-' + ts + '-' + rand;
  }

  function formatCurrency(amount) {
    return '$' + amount.toFixed(2);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.MMWebapp = {
    // Firebase
    initFirebase: initFirebase,
    fb: {
      push: fbPush,
      set: fbSet,
      update: fbUpdate,
      get: fbGet,
      listen: fbListen,
      increment: fbIncrement,
      transactionAdd: fbTransactionAdd
    },

    // Camera
    startCamera: startCamera,
    stopCamera: stopCamera,
    switchCamera: switchCamera,
    capturePhoto: capturePhoto,
    compressImage: compressImage,

    // Upload
    uploadPhoto: uploadPhoto,

    // Events API
    createEventFolder: createEventFolder,
    getEvents: getEvents,

    // Offline Queue
    queueUpload: queueUpload,
    processQueue: processQueue,
    getQueueLength: function () { return getQueue().length; },

    // Utilities
    getTodayString: getTodayString,
    showToast: showToast,
    generateOrderId: generateOrderId,
    formatCurrency: formatCurrency,

    // Config (can override before use)
    config: {
      appsScriptUrl: APPS_SCRIPT_URL,
      maxImageDimension: MAX_IMAGE_DIMENSION,
      jpegQuality: JPEG_QUALITY
    }
  };
})();
