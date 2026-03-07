/**
 * Google Apps Script — Magnet Moments Co. Photo Upload & Event API
 *
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Go to https://script.google.com
 * 2. Create a new project → name it "Magnet Moments Webapp"
 * 3. Paste this entire file into Code.gs
 * 4. Click Deploy → New deployment
 * 5. Type: Web app
 * 6. Execute as: Me (your Google account)
 * 7. Who has access: Anyone
 * 8. Click Deploy → copy the URL
 * 9. Update APPS_SCRIPT_URL in webapp-shared.js with that URL
 *
 * REQUIRED: The Google account must have Google Drive access.
 * The root folder "Magnet Moments Uploads" is auto-created on first use.
 */

// ── Configuration ──────────────────────────────────────────────────────────────
var ROOT_FOLDER_NAME = 'Magnet Moments Uploads';
var ALLOWED_ORIGINS = [
  'https://magnetmomentsco.us',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];
var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
var ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
];

// ── CORS Preflight ─────────────────────────────────────────────────────────────
function doOptions(e) {
  return buildCorsResponse('');
}

// ── Main Router ────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    switch (action) {
      case 'upload':
        return handleUpload(data);
      case 'create-event':
        return handleCreateEvent(data);
      case 'get-events':
        return handleGetEvents(data);
      case 'end-event':
        return handleEndEvent(data);
      default:
        return buildCorsResponse(JSON.stringify({
          success: false,
          error: 'Unknown action: ' + action
        }));
    }
  } catch (err) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Server error: ' + err.message
    }));
  }
}

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'get-events') {
    return handleGetEvents({});
  }
  return buildCorsResponse(JSON.stringify({
    success: true,
    message: 'Magnet Moments API is running'
  }));
}

// ── Photo Upload Handler ───────────────────────────────────────────────────────
function handleUpload(data) {
  // Validate required fields
  if (!data.photo || !data.mode) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Missing required fields: photo, mode'
    }));
  }

  // Validate mode
  if (data.mode !== 'market' && data.mode !== 'event') {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Invalid mode. Must be "market" or "event"'
    }));
  }

  // Decode base64 photo
  var photoBytes;
  var dataUrlMime = null;
  try {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,")
    var base64Data = data.photo;
    if (typeof base64Data === 'string' && base64Data.indexOf('data:') === 0 && base64Data.indexOf(',') !== -1) {
      // Extract MIME from the data URL itself — most reliable source
      var semiIdx = base64Data.indexOf(';');
      if (semiIdx > 5) dataUrlMime = base64Data.substring(5, semiIdx);
      base64Data = base64Data.substring(base64Data.indexOf(',') + 1);
    } else if (typeof base64Data === 'string' && base64Data.indexOf(',') !== -1) {
      base64Data = base64Data.substring(base64Data.indexOf(',') + 1);
    }
    photoBytes = Utilities.base64Decode(base64Data);
  } catch (err) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Invalid photo data'
    }));
  }

  // Validate size
  if (photoBytes.length > MAX_FILE_SIZE) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'File too large. Maximum size is 10MB'
    }));
  }

  // Determine MIME type — prefer data URL > client claim > default
  var mimeType = dataUrlMime || data.mimeType || 'image/jpeg';
  if (ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Invalid file type. Allowed: JPEG, PNG, WebP, HEIC'
    }));
  }

  // Validate actual file signature against claimed MIME type
  var detectedMime = detectMimeFromBytes(photoBytes);
  if (detectedMime && detectedMime !== mimeType) {
    mimeType = detectedMime; // trust bytes over claim
  }
  if (ALLOWED_MIME_TYPES.indexOf(mimeType) === -1) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'File content does not match an allowed image type'
    }));
  }

  // Determine file extension
  var ext = '.jpg';
  if (mimeType === 'image/png') ext = '.png';
  else if (mimeType === 'image/webp') ext = '.webp';
  else if (mimeType === 'image/heic' || mimeType === 'image/heif') ext = '.heic';

  // Build folder path
  var rootFolder = getOrCreateRootFolder();
  var targetFolder;

  if (data.mode === 'market') {
    var dateStr = data.date || getTodayString();
    var marketFolderName = 'market-' + dateStr;
    var marketFolder = getOrCreateSubfolder(rootFolder, marketFolderName);

    // Payment method sub-folder
    var paymentMethod = sanitizeFolderName(data.paymentMethod || 'unspecified');
    targetFolder = getOrCreateSubfolder(marketFolder, paymentMethod);
  } else {
    // Event mode
    if (!data.eventFolderId) {
      return buildCorsResponse(JSON.stringify({
        success: false,
        error: 'Missing eventFolderId for event mode'
      }));
    }
    try {
      targetFolder = DriveApp.getFolderById(data.eventFolderId);
      // Verify the folder is within our root folder to prevent arbitrary Drive writes
      var parents = targetFolder.getParents();
      var isValid = false;
      while (parents.hasNext()) {
        if (parents.next().getName() === ROOT_FOLDER_NAME) { isValid = true; break; }
      }
      if (!isValid) {
        return buildCorsResponse(JSON.stringify({
          success: false,
          error: 'Event folder must be within the Magnet Moments root folder'
        }));
      }
    } catch (err) {
      return buildCorsResponse(JSON.stringify({
        success: false,
        error: 'Event folder not found'
      }));
    }
  }

  // Generate unique filename
  var timestamp = Utilities.formatDate(new Date(), 'America/Chicago', 'HHmmss');
  var randomId = Math.random().toString(36).substring(2, 8);
  var prefix = data.mode === 'market' ? 'order' : 'guest';
  var fileName = prefix + '-' + timestamp + '-' + randomId + ext;

  // Save file — explicitly set content type on the blob for Drive compatibility
  var blob = Utilities.newBlob(photoBytes);
  blob.setName(fileName);
  blob.setContentType(mimeType);
  var file = targetFolder.createFile(blob);

  return buildCorsResponse(JSON.stringify({
    success: true,
    fileId: file.getId(),
    fileName: fileName,
    folderName: targetFolder.getName()
  }));
}

// ── Event Management ───────────────────────────────────────────────────────────
function handleCreateEvent(data) {
  if (!data.name || !data.date) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Missing required fields: name, date'
    }));
  }

  // Validate input lengths
  if (String(data.name).length > 200 || String(data.date).length > 20) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Input too long'
    }));
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Invalid date format. Expected YYYY-MM-DD'
    }));
  }

  var rootFolder = getOrCreateRootFolder();
  var folderName = 'event-' + data.date + '-' + sanitizeFolderName(data.name);
  var eventFolder = getOrCreateSubfolder(rootFolder, folderName);

  return buildCorsResponse(JSON.stringify({
    success: true,
    folderId: eventFolder.getId(),
    folderName: folderName,
    folderUrl: eventFolder.getUrl()
  }));
}

function handleGetEvents(data) {
  var rootFolder = getOrCreateRootFolder();
  var folders = rootFolder.getFolders();
  var events = [];

  while (folders.hasNext()) {
    var folder = folders.next();
    var name = folder.getName();
    if (name.indexOf('event-') === 0 || name.indexOf('market-') === 0) {
      var files = folder.getFiles();
      var fileCount = 0;
      while (files.hasNext()) {
        files.next();
        fileCount++;
      }
      // Also count files in sub-folders (for market mode)
      var subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        var sub = subFolders.next();
        var subFiles = sub.getFiles();
        while (subFiles.hasNext()) {
          subFiles.next();
          fileCount++;
        }
      }
      events.push({
        id: folder.getId(),
        name: name,
        photoCount: fileCount,
        url: folder.getUrl(),
        created: folder.getDateCreated().toISOString()
      });
    }
  }

  // Sort newest first
  events.sort(function(a, b) {
    return new Date(b.created) - new Date(a.created);
  });

  return buildCorsResponse(JSON.stringify({
    success: true,
    events: events
  }));
}

function handleEndEvent(data) {
  if (!data.folderId) {
    return buildCorsResponse(JSON.stringify({
      success: false,
      error: 'Missing folderId'
    }));
  }

  // We don't delete the folder — just return confirmation
  // Admin can manage archival from Drive directly
  return buildCorsResponse(JSON.stringify({
    success: true,
    message: 'Event ended. Photos preserved in Drive.'
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function getOrCreateRootFolder() {
  var folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getOrCreateSubfolder(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parent.createFolder(name);
}

function getTodayString() {
  return Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
}

function sanitizeFolderName(name) {
  // Remove characters not safe for Drive folder names
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 100);
}

function detectMimeFromBytes(bytes) {
  if (bytes.length < 4) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === -1 && bytes[1] === -40 && bytes[2] === -1) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (bytes[0] === -119 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  // WebP: RIFF....WEBP
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  // HEIC/HEIF: ftyp box at offset 4
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'image/heic';
  return null;
}

function buildCorsResponse(body) {
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}
