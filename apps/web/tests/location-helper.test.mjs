import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatGeolocationError,
  getGeolocationAttemptOptions,
  isEmbeddedInAppBrowser,
} from '../src/features/chat/location-helper.ts';

test('mobile permission denial gives device-specific guidance', () => {
  for (const permissionState of [undefined, 'denied', 'granted']) {
    const iphone = formatGeolocationError({
      code: 1,
      embedded: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      permissionState,
    });
    assert.match(iphone, /iPhone/);
    assert.doesNotMatch(iphone, /Windows|ứng dụng máy tính/);
    const android = formatGeolocationError({
      code: 1,
      embedded: false,
      userAgent: 'Mozilla/5.0 (Linux; Android 14)',
      permissionState,
    });
    assert.match(android, /Điện thoại|điện thoại/);
    assert.doesNotMatch(android, /Windows/);
  }
  assert.match(
    formatGeolocationError({
      code: 1,
      embedded: true,
      userAgent: 'iPhone Messenger/450',
    }),
    /mở trang này bằng Safari/,
  );
});

test('location errors distinguish policy, saved denial, OS denial and a pending prompt', () => {
  assert.match(
    formatGeolocationError({
      code: 1,
      embedded: false,
      policyAllowed: false,
      permissionState: 'denied',
    }),
    /chính sách nhúng hoặc máy chủ/,
  );
  assert.match(
    formatGeolocationError({
      code: 1,
      embedded: false,
      permissionState: 'denied',
    }),
    /sẽ không hỏi lại/,
  );
  assert.match(
    formatGeolocationError({
      code: 1,
      embedded: false,
      permissionState: 'denied',
      browserMessage: 'User denied Geolocation: System denied location',
    }),
    /hệ điều hành/,
  );
  assert.match(
    formatGeolocationError({
      code: 1,
      embedded: false,
      permissionState: 'granted',
    }),
    /không hiện yêu cầu cấp quyền mới/,
  );
  assert.match(
    formatGeolocationError({
      code: 3,
      embedded: false,
      permissionState: 'prompt',
    }),
    /bên phải thanh địa chỉ/,
  );
  assert.doesNotMatch(
    formatGeolocationError({
      code: 2,
      embedded: false,
      permissionState: 'granted',
    }),
    /chưa cấp quyền|sẽ không hỏi lại/,
  );
});

test('isEmbeddedInAppBrowser detects Messenger and common in-app WebViews', () => {
  assert.equal(
    isEmbeddedInAppBrowser(
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]',
    ),
    true,
  );
  assert.equal(
    isEmbeddedInAppBrowser(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Messenger/450',
    ),
    true,
  );
  assert.equal(
    isEmbeddedInAppBrowser(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0.0.0 Mobile Safari/537.36',
    ),
    false,
  );
});

test('getGeolocationAttemptOptions gives standard browsers margin for permission prompts', () => {
  const standardCoarse = getGeolocationAttemptOptions(false, false);
  assert.equal(standardCoarse.enableHighAccuracy, false);
  assert.ok(standardCoarse.watchdogMs >= standardCoarse.timeoutMs + 15000);

  const embeddedCoarse = getGeolocationAttemptOptions(true, false);
  assert.ok(embeddedCoarse.watchdogMs < standardCoarse.watchdogMs);

  const standardGps = getGeolocationAttemptOptions(false, true);
  assert.equal(standardGps.enableHighAccuracy, true);
  assert.ok(standardGps.timeoutMs >= standardCoarse.timeoutMs);
});

test('formatGeolocationError provides actionable guidance for embedded, denied, and insecure contexts', () => {
  const embeddedDenied = formatGeolocationError({ code: 1, embedded: true });
  assert.match(embeddedDenied, /trình duyệt ngoài|bản đồ/i);

  const embeddedTimeout = formatGeolocationError({ code: 3, embedded: true });
  assert.match(embeddedTimeout, /bản đồ/i);

  const chromeDenied = formatGeolocationError({ code: 1, embedded: false });
  assert.match(chromeDenied, /cài đặt trình duyệt|bản đồ/i);

  const chromeUnavailable = formatGeolocationError({
    code: 2,
    embedded: false,
  });
  assert.match(chromeUnavailable, /Dịch vụ vị trí|bản đồ/i);

  const insecure = formatGeolocationError({
    embedded: false,
    secureContext: false,
  });
  assert.match(insecure, /HTTPS/);
});
