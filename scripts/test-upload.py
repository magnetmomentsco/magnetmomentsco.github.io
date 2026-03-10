#!/usr/bin/env python3
"""
End-to-end upload test for Magnet Moments Apps Script endpoint.

Reads APPS_SCRIPT_URL from .env and sends test uploads to verify:
  1. Market mode upload (with customer name/phone)
  2. Event folder creation
  3. Event mode upload (to created folder)
  4. GET endpoint health check

Usage:
  python3 scripts/test-upload.py
"""
import base64, json, os, sys, time, urllib.request, urllib.error

# ── Load env ──────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, '.env')
APPS_SCRIPT_URL = ''

if os.path.exists(ENV_PATH):
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line.startswith('APPS_SCRIPT_URL='):
                APPS_SCRIPT_URL = line.split('=', 1)[1].strip()

if not APPS_SCRIPT_URL:
    print('❌ APPS_SCRIPT_URL not found in .env')
    sys.exit(1)

# ── Tiny valid JPEG (1x1 pixel) ──────────────────────────────────────────────
MINIMAL_JPEG = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    b'\xff\xdb\x00\x43\x00' + bytes(range(1, 65)) +
    b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
    b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01'
    b'\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b'
    b'\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04'
    b'\x00\x00\x01\x7d\x01\x02\x03\x00\x04\x11\x05\x12\x21\x31\x41\x06\x13'
    b'\x51\x61\x07\x22\x71\x14\x32\x81\x91\xa1\x08\x23\x42\xb1\xc1\x15\x52'
    b'\xd1\xf0\x24\x33\x62\x72\x82\x09\x0a\x16\x17\x18\x19\x1a\x25\x26\x27'
    b'\x28\x29\x2a\x34\x35\x36\x37\x38\x39\x3a\x43\x44\x45\x46\x47\x48\x49'
    b'\x4a\x53\x54\x55\x56\x57\x58\x59\x5a\x63\x64\x65\x66\x67\x68\x69\x6a'
    b'\x73\x74\x75\x76\x77\x78\x79\x7a\x83\x84\x85\x86\x87\x88\x89\x8a\x92'
    b'\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9\xaa'
    b'\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9'
    b'\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7'
    b'\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa'
    b'\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x7b\x40\x1b\xff\xd9'
)
TEST_DATA_URL = 'data:image/jpeg;base64,' + base64.b64encode(MINIMAL_JPEG).decode()


def post_json(url, payload, timeout=60):
    """POST JSON to Apps Script (no Content-Type header, like our browser code)."""
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode('utf-8'))


def test_health():
    """Test 1: GET health check."""
    print('\n── Test 1: Health check (GET) ──')
    resp = urllib.request.urlopen(APPS_SCRIPT_URL, timeout=30)
    data = json.loads(resp.read().decode())
    assert data.get('success') is True, f'Expected success, got: {data}'
    print(f'   ✅ API is running: {data.get("message")}')


def test_market_upload():
    """Test 2: Market mode upload."""
    print('\n── Test 2: Market upload ──')
    result = post_json(APPS_SCRIPT_URL, {
        'action': 'upload',
        'photo': TEST_DATA_URL,
        'mimeType': 'image/jpeg',
        'mode': 'market',
        'date': '2026-03-09',
        'paymentMethod': 'cash-tap',
        'customerName': 'E2ETest',
        'customerPhone': '5550000000',
    })
    assert result.get('success') is True, f'Upload failed: {result}'
    assert result.get('fileId'), 'No fileId returned'
    assert result.get('fileName', '').endswith('.jpg'), f'Unexpected filename: {result.get("fileName")}'
    print(f'   ✅ Uploaded: {result["fileName"]} → {result["folderName"]}  (id={result["fileId"]})')
    return result


def test_create_event():
    """Test 3: Create event folder."""
    print('\n── Test 3: Create event folder ──')
    result = post_json(APPS_SCRIPT_URL, {
        'action': 'create-event',
        'name': 'E2E Test Event',
        'date': '2026-03-09',
    })
    assert result.get('success') is True, f'Create event failed: {result}'
    assert result.get('folderId'), 'No folderId returned'
    print(f'   ✅ Folder: {result["folderName"]}  (id={result["folderId"]})')
    return result


def test_event_upload(folder_id):
    """Test 4: Event mode upload to created folder."""
    print('\n── Test 4: Event upload ──')
    result = post_json(APPS_SCRIPT_URL, {
        'action': 'upload',
        'photo': TEST_DATA_URL,
        'mimeType': 'image/jpeg',
        'mode': 'event',
        'eventFolderId': folder_id,
    })
    assert result.get('success') is True, f'Event upload failed: {result}'
    assert result.get('fileId'), 'No fileId returned'
    print(f'   ✅ Uploaded: {result["fileName"]} → {result["folderName"]}  (id={result["fileId"]})')
    return result


def test_invalid_mode():
    """Test 5: Invalid mode should fail."""
    print('\n── Test 5: Invalid mode rejection ──')
    result = post_json(APPS_SCRIPT_URL, {
        'action': 'upload',
        'photo': TEST_DATA_URL,
        'mimeType': 'image/jpeg',
        'mode': 'bogus',
    })
    assert result.get('success') is False, f'Expected failure, got: {result}'
    print(f'   ✅ Correctly rejected: {result.get("error")}')


def test_missing_photo():
    """Test 6: Missing photo should fail."""
    print('\n── Test 6: Missing photo rejection ──')
    result = post_json(APPS_SCRIPT_URL, {
        'action': 'upload',
        'mode': 'market',
    })
    assert result.get('success') is False, f'Expected failure, got: {result}'
    print(f'   ✅ Correctly rejected: {result.get("error")}')


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print(f'Apps Script URL: {APPS_SCRIPT_URL[:60]}...')
    passed = 0
    failed = 0
    total_start = time.time()

    tests = [
        ('Health check', test_health, []),
        ('Market upload', test_market_upload, []),
        ('Create event', test_create_event, []),
        ('Invalid mode', test_invalid_mode, []),
        ('Missing photo', test_missing_photo, []),
    ]

    event_folder_id = None

    for name, fn, args in tests:
        try:
            result = fn(*args)
            if name == 'Create event' and result:
                event_folder_id = result['folderId']
            passed += 1
        except Exception as e:
            print(f'   ❌ FAILED: {e}')
            failed += 1

    # Event upload depends on create-event result
    if event_folder_id:
        try:
            test_event_upload(event_folder_id)
            passed += 1
        except Exception as e:
            print(f'   ❌ FAILED: {e}')
            failed += 1
    else:
        print('\n── Test 4: Event upload ── SKIPPED (no folder ID)')

    elapsed = time.time() - total_start
    print(f'\n{"═" * 50}')
    print(f'Results: {passed} passed, {failed} failed ({elapsed:.1f}s)')
    if failed:
        print('❌ Some tests failed!')
        sys.exit(1)
    else:
        print('✅ All tests passed!')
