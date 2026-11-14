import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatGeolocationError,
  isEmbeddedInAppBrowser,
} from '../src/features/chat/location-helper.ts';

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

test('formatGeolocationError provides actionable guidance for embedded, denied, and insecure contexts', () => {
  const embeddedDenied = formatGeolocationError({ code: 1, embedded: true });
  assert.match(embeddedDenied, /trình duyệt ngoài/i);

  const embeddedTimeout = formatGeolocationError({ code: 3, embedded: true });
  assert.match(embeddedTimeout, /trình duyệt ngoài/i);

  const chromeDenied = formatGeolocationError({ code: 1, embedded: false });
  assert.match(chromeDenied, /cài đặt trang web/i);

  const chromeUnavailable = formatGeolocationError({
    code: 2,
    embedded: false,
  });
  assert.match(chromeUnavailable, /GPS/i);

  const insecure = formatGeolocationError({
    embedded: false,
    secureContext: false,
  });
  assert.match(insecure, /HTTPS/);
});
