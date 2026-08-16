const KEY_PART_C = 'CeStyDH4H5S';
const KEY_PART_A = 'EVSHcmz/ry6';
const KEY_PART_D = 'wYYprH2z0I=';
const KEY_PART_B = '7zkmdTXFEuH';
let keyPromise = null;

function getGalleryKey() {
  if (!keyPromise) {
    const encodedKey = KEY_PART_A + KEY_PART_B + KEY_PART_C + KEY_PART_D;
    const keyBytes = Uint8Array.from(
      atob(encodedKey),
      character => character.charCodeAt(0),
    );
    keyPromise = crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
  }
  return keyPromise;
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  const scopeUrl = new URL(self.registration.scope);
  const imagePrefix = `${scopeUrl.pathname}gallery-image/`;
  const coverPrefix = `${scopeUrl.pathname}gallery-cover/`;
  const dataPrefix = `${scopeUrl.pathname}gallery-data/`;

  if (requestUrl.origin !== scopeUrl.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith(imagePrefix)) {
    event.respondWith(decryptImage(requestUrl, imagePrefix));
  } else if (requestUrl.pathname.startsWith(coverPrefix)) {
    event.respondWith(decryptCover(requestUrl, coverPrefix));
  } else if (requestUrl.pathname.startsWith(dataPrefix)) {
    event.respondWith(decryptMetadata(requestUrl, dataPrefix));
  }
});

async function decryptImage(requestUrl, imagePrefix) {
  const filename = decodeURIComponent(requestUrl.pathname.slice(imagePrefix.length));
  const match = /^([a-f0-9]{32})\.webp$/.exec(filename);
  if (!match) {
    return new Response('Invalid gallery image', { status: 400 });
  }

  const encryptedUrl = new URL(`data/${match[1]}`, self.registration.scope);
  return decryptAsset(encryptedUrl, 'image/webp', 'gallery image');
}

async function decryptCover(requestUrl, coverPrefix) {
  const filename = decodeURIComponent(requestUrl.pathname.slice(coverPrefix.length));
  const match = /^([a-f0-9]{32})\.webp$/.exec(filename);
  if (!match) {
    return new Response('Invalid gallery cover', { status: 400 });
  }

  const encryptedUrl = new URL(`data/c.${match[1]}`, self.registration.scope);
  return decryptAsset(encryptedUrl, 'image/webp', 'gallery cover');
}

async function decryptMetadata(requestUrl, dataPrefix) {
  const filename = decodeURIComponent(requestUrl.pathname.slice(dataPrefix.length));
  const match = /^([a-z0-9-]+)\.json$/.exec(filename);
  if (!match) {
    return new Response('Invalid gallery metadata', { status: 400 });
  }

  const encryptedUrl = new URL(`data/galleries/${match[1]}.json`, self.registration.scope);
  return decryptAsset(encryptedUrl, 'application/json; charset=utf-8', 'gallery metadata');
}

async function decryptAsset(encryptedUrl, contentType, label) {
  try {
    const encryptedResponse = await fetch(encryptedUrl, { cache: 'no-cache' });
    if (!encryptedResponse.ok) {
      return new Response(`${label} not found`, { status: encryptedResponse.status });
    }

    const encrypted = new Uint8Array(await encryptedResponse.arrayBuffer());
    if (encrypted.length < 29) {
      throw new Error('Encrypted payload is too short.');
    }
    const nonce = encrypted.slice(0, 12);
    const ciphertext = encrypted.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      await getGalleryKey(),
      ciphertext,
    );

    return new Response(plaintext, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error(`Could not decrypt ${label}`, error);
    return new Response(`Could not decrypt ${label}`, { status: 500 });
  }
}