(() => {
  "use strict";

  let galleryData = null;
  const unlockScreen = document.querySelector("#unlockScreen");
  const unlockForm = document.querySelector("#unlockForm");
  const albumKeyInput = document.querySelector("#albumKey");
  const unlockMessage = document.querySelector("#unlockMessage");
  const skipLink = document.querySelector(".skip-link");
  const siteHeader = document.querySelector("#siteHeader");
  const pageMain = document.querySelector("main");
  const siteFooter = document.querySelector(".site-footer");
  const photoGrid = document.querySelector("#photoGrid");
  const visibleCount = document.querySelector("#visibleCount");
  const decryptStatus = document.querySelector("#decryptStatus");
  const heroPhoto = document.querySelector("#heroPhoto");
  const filterButtons = [...document.querySelectorAll(".filter")];
  const lightbox = document.querySelector("#lightbox");
  const lightboxPhoto = document.querySelector("#lightboxPhoto");
  const lightboxClose = document.querySelector("#lightboxClose");
  const lightboxPrev = document.querySelector("#lightboxPrev");
  const lightboxNext = document.querySelector("#lightboxNext");

  const PHOTO_MAGIC = new Uint8Array([87, 69, 68, 49]); // WED1
  const GALLERY_MAGIC = new Uint8Array([87, 71, 68, 49]); // WGD1
  const GALLERY_DATA_URL = "gallery-data?v=20260830-3";
  const objectUrls = new Set();
  const photoUrlPromises = new Map();
  const cardByPhotoId = new Map();
  const loadedPhotoIds = new Set();
  const failedPhotoIds = new Set();
  let albumCryptoKey = null;
  let activeFilter = "all";
  let activePhotos = [];
  let lightboxIndex = 0;
  let imageObserver = null;
  let loadToken = 0;

  document.body.classList.add("is-locked");
  const lockedPageRegions = [skipLink, siteHeader, pageMain, siteFooter, lightbox];
  lockedPageRegions.forEach((region) => {
    region.inert = true;
    region.setAttribute("aria-hidden", "true");
  });

  function setUnlockMessage(message, state = "") {
    unlockMessage.textContent = message;
    unlockMessage.dataset.state = state;
  }

  function setDecryptStatus(message, isError = false) {
    decryptStatus.textContent = message;
    decryptStatus.classList.toggle("is-error", isError);
  }

  async function deriveAlbumKey(password, salt, iterations) {
    const passwordBytes = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    passwordBytes.fill(0);

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }

  function hasValidContainerHeader(packed, magic) {
    return magic.every((byte, index) => packed[index] === byte);
  }

  async function fetchEncryptedBytes(url, unavailableMessage) {
    let response;
    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (error) {
      const fetchError = new Error(
        location.protocol === "file:"
          ? "Serve the album from HTTPS or localhost; encrypted data cannot load from file://."
          : unavailableMessage,
      );
      fetchError.cause = error;
      fetchError.kind = "network";
      throw fetchError;
    }

    if (!response.ok) {
      const responseError = new Error(`Encrypted data request failed (${response.status}).`);
      responseError.kind = "network";
      throw responseError;
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  function validateGalleryData(data) {
    const allowedCategories = new Set(["red", "garden", "formal", "studio"]);
    const validPhotos =
      Array.isArray(data?.photos) &&
      data.photos.length > 0 &&
      data.photos.every(
        (photo) =>
          Number.isInteger(photo?.id) &&
          typeof photo.src === "string" &&
          /^assets\/[a-f\d]{32}$/i.test(photo.src) &&
          allowedCategories.has(photo.category) &&
          Number.isInteger(photo.width) &&
          Number.isInteger(photo.height) &&
          Math.max(photo.width, photo.height) === 900 &&
          !("alt" in photo),
      );
    const uniqueIds = validPhotos && new Set(data.photos.map(({ id }) => id)).size === data.photos.length;

    if (
      data?.version !== 1 ||
      !Number.isInteger(data.featuredPhotoId) ||
      !validPhotos ||
      !uniqueIds ||
      !data.photos.some(({ id }) => id === data.featuredPhotoId)
    ) {
      const error = new Error("The decrypted gallery data is invalid.");
      error.kind = "configuration";
      throw error;
    }

    return data;
  }

  async function decryptGalleryData(password) {
    const packed = await fetchEncryptedBytes(
      GALLERY_DATA_URL,
      "The encrypted gallery data could not be reached.",
    );
    if (packed.length < 53 || !hasValidContainerHeader(packed, GALLERY_MAGIC)) {
      const error = new Error("The encrypted gallery has an invalid container.");
      error.kind = "configuration";
      throw error;
    }

    const iterations = new DataView(
      packed.buffer,
      packed.byteOffset + 4,
      4,
    ).getUint32(0, false);
    if (iterations < 100_000 || iterations > 1_000_000) {
      const error = new Error("The gallery key parameters are invalid.");
      error.kind = "configuration";
      throw error;
    }

    const authenticatedHeader = packed.slice(0, 24);
    const salt = packed.slice(8, 24);
    const iv = packed.slice(24, 36);
    const encryptedBytes = packed.slice(36);
    albumCryptoKey = await deriveAlbumKey(password, salt, iterations);
    const decryptedBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: authenticatedHeader,
        tagLength: 128,
      },
      albumCryptoKey,
      encryptedBytes,
    );

    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(decryptedBytes);
      return validateGalleryData(JSON.parse(decoded));
    } catch (error) {
      if (error.kind === "configuration") throw error;
      const dataError = new Error("The decrypted gallery data could not be read.");
      dataError.kind = "configuration";
      dataError.cause = error;
      throw dataError;
    }
  }

  function decryptedPhotoUrl(photo) {
    if (photoUrlPromises.has(photo.id)) {
      return photoUrlPromises.get(photo.id);
    }

    const pending = (async () => {
      if (!albumCryptoKey) {
        throw new Error("The album is locked.");
      }

      const packed = await fetchEncryptedBytes(
        photo.src,
        "The encrypted photograph could not be reached.",
      );
      if (packed.length < 33 || !hasValidContainerHeader(packed, PHOTO_MAGIC)) {
        throw new Error("The encrypted photograph has an invalid container.");
      }

      const iv = packed.slice(4, 16);
      const encryptedBytes = packed.slice(16);
      const decryptedBytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: PHOTO_MAGIC,
          tagLength: 128,
        },
        albumCryptoKey,
        encryptedBytes,
      );

      const url = URL.createObjectURL(new Blob([decryptedBytes], { type: "image/jpeg" }));
      objectUrls.add(url);
      return url;
    })();

    photoUrlPromises.set(photo.id, pending);
    pending.catch(() => photoUrlPromises.delete(photo.id));
    return pending;
  }

  function updateLoadedStatus() {
    const total = galleryData.photos.length;
    const loaded = loadedPhotoIds.size;
    const failed = failedPhotoIds.size;
    setDecryptStatus(
      failed
        ? `Unveiled ${loaded} of ${total} · ${failed} unavailable`
        : loaded === total
        ? `Album unveiled · ${total} of ${total}`
        : `Unveiled ${loaded} of ${total}`,
      failed > 0,
    );
  }

  async function attachPhoto(img, photo) {
    const shell = img.closest(".photo-shell");
    const token = String(++loadToken);
    img.dataset.loadToken = token;
    img.classList.remove("is-loaded");
    shell?.classList.remove("is-loaded", "is-error");
    shell?.classList.add("is-loading");

    try {
      const url = await decryptedPhotoUrl(photo);
      if (img.dataset.loadToken !== token) return;

      img.src = url;
      img.style.objectPosition = photo.focus ?? "50% 50%";
      await img.decode();
      if (img.dataset.loadToken !== token) return;

      img.classList.add("is-loaded");
      shell?.classList.remove("is-loading");
      shell?.classList.add("is-loaded");
      failedPhotoIds.delete(photo.id);
      loadedPhotoIds.add(photo.id);
      updateLoadedStatus();
      return true;
    } catch (error) {
      if (img.dataset.loadToken !== token) return;
      shell?.classList.remove("is-loading");
      shell?.classList.add("is-error");
      failedPhotoIds.add(photo.id);
      updateLoadedStatus();
      console.error(`Could not open ${photo.id}`, error);
      return false;
    }
  }

  function buildPhotoCard(photo, index) {
    const card = document.createElement("article");
    card.className = "photo-card";
    card.dataset.category = photo.category;
    card.dataset.photoId = photo.id;

    const button = document.createElement("button");
    button.className = "photo-card__button";
    button.type = "button";
    button.setAttribute("aria-label", `Open photograph ${index + 1}`);

    const shell = document.createElement("span");
    shell.className = "photo-card__image photo-shell is-loading";
    shell.style.setProperty("--photo-ratio", `${photo.width} / ${photo.height}`);
    shell.style.setProperty("--photo-focus", photo.focus ?? "50% 50%");

    const image = document.createElement("img");
    image.className = "protected-photo";
    image.width = photo.width;
    image.height = photo.height;
    image.loading = "lazy";
    image.decoding = "async";
    image.dataset.photoId = photo.id;

    const fallback = document.createElement("span");
    fallback.className = "photo-shell__fallback";
    fallback.setAttribute("aria-hidden", "true");
    const fallbackMark = document.createElement("span");
    fallbackMark.lang = "zh-Hans";
    fallbackMark.textContent = "囍";
    fallback.append(fallbackMark);

    shell.append(image, fallback);
    button.append(shell);
    button.addEventListener("click", () => openLightbox(photo.id));
    card.append(button);
    cardByPhotoId.set(photo.id, { card, image });
    return card;
  }

  function renderGallery() {
    const fragment = document.createDocumentFragment();
    galleryData.photos.forEach((photo, index) => {
      fragment.append(buildPhotoCard(photo, index));
    });
    photoGrid.append(fragment);
    activePhotos = [...galleryData.photos];
    visibleCount.textContent = String(activePhotos.length);
  }

  function startImageLoading() {
    const images = [...photoGrid.querySelectorAll("img[data-photo-id]")];

    if (!("IntersectionObserver" in window)) {
      images.forEach((image) => {
        const photo = galleryData.photos.find(
          ({ id }) => String(id) === image.dataset.photoId,
        );
        attachPhoto(image, photo);
      });
      return;
    }

    imageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(async (entry) => {
          if (!entry.isIntersecting) return;
          imageObserver.unobserve(entry.target);
          const photo = galleryData.photos.find(
            ({ id }) => String(id) === entry.target.dataset.photoId,
          );
          const loaded = await attachPhoto(entry.target, photo);
          if (!loaded) {
            const attempts = Number(entry.target.dataset.loadAttempts ?? 0) + 1;
            entry.target.dataset.loadAttempts = String(attempts);
            if (attempts < 3 && albumCryptoKey) {
              window.setTimeout(() => imageObserver?.observe(entry.target), 1_200);
            }
          }
        });
      },
      { rootMargin: "650px 0px" },
    );

    images.forEach((image) => imageObserver.observe(image));
  }

  function setFilter(filter) {
    activeFilter = filter;
    filterButtons.forEach((button) => {
      const isActive = button.dataset.filter === filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    activePhotos = galleryData.photos.filter(
      (photo) => filter === "all" || photo.category === filter,
    );
    visibleCount.textContent = String(activePhotos.length);

    galleryData.photos.forEach((photo) => {
      const { card } = cardByPhotoId.get(photo.id);
      card.hidden = !activePhotos.includes(photo);
    });

    if (lightbox.open) lightbox.close();
  }

  function showLightboxPhoto() {
    const photo = activePhotos[lightboxIndex];

    lightboxPhoto.removeAttribute("src");
    lightboxPhoto.classList.remove("is-loaded");
    attachPhoto(lightboxPhoto, photo);
  }

  function openLightbox(photoId) {
    lightboxIndex = activePhotos.findIndex(({ id }) => id === photoId);
    if (lightboxIndex < 0) return;
    if (!lightbox.open) lightbox.showModal();
    document.body.classList.add("has-modal");
    showLightboxPhoto();
  }

  function stepLightbox(direction) {
    lightboxIndex = (lightboxIndex + direction + activePhotos.length) % activePhotos.length;
    showLightboxPhoto();
  }

  function setupRevealAnimations() {
    const revealTargets = [
      ...document.querySelectorAll(".section-reveal"),
      ...document.querySelectorAll(".photo-card"),
    ];

    if (!("IntersectionObserver" in window)) {
      revealTargets.forEach((target) => target.classList.add("is-visible"));
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -7%", threshold: 0.06 },
    );

    revealTargets.forEach((target) => revealObserver.observe(target));
  }

  function unlockAlbum() {
    unlockScreen.classList.add("is-open");
    lockedPageRegions.forEach((region) => {
      region.inert = false;
      region.removeAttribute("aria-hidden");
    });
    window.setTimeout(() => {
      unlockScreen.hidden = true;
      document.body.classList.remove("is-locked");
      pageMain.focus({ preventScroll: true });
    }, 700);

    const featured = galleryData.photos.find(
      ({ id }) => id === galleryData.featuredPhotoId,
    );
    attachPhoto(heroPhoto, featured);
    startImageLoading();
  }

  async function handleUnlock(event) {
    event.preventDefault();
    const submitButton = unlockForm.querySelector("button[type='submit']");
    const password = albumKeyInput.value;

    if (!password) {
      setUnlockMessage("Enter the album password.", "error");
      albumKeyInput.focus();
      return;
    }

    submitButton.disabled = true;
    albumKeyInput.disabled = true;
    setUnlockMessage("Opening the album…", "loading");

    try {
      galleryData = await decryptGalleryData(password);
      albumKeyInput.value = "";
      renderGallery();
      setupRevealAnimations();
      setUnlockMessage("Album opened.", "success");
      unlockAlbum();
    } catch (error) {
      albumCryptoKey = null;
      galleryData = null;
      photoUrlPromises.clear();
      albumKeyInput.value = "";
      albumKeyInput.disabled = false;
      submitButton.disabled = false;

      if (error.kind === "network") {
        setUnlockMessage(error.message, "error");
      } else if (error.kind === "configuration") {
        setUnlockMessage("The encrypted album data is damaged or invalid.", "error");
      } else {
        setUnlockMessage("That password did not open the album. Please try again.", "error");
      }
      albumKeyInput.focus();
    }
  }

  function showConfigurationError(message) {
    setUnlockMessage(message, "error");
    albumKeyInput.disabled = true;
    unlockForm.querySelector("button[type='submit']").disabled = true;
  }

  function init() {
    if (!window.crypto?.subtle) {
      showConfigurationError("This browser cannot open the encrypted album. Use a modern browser over HTTPS or localhost.");
      return;
    }

    setDecryptStatus("Album locked");
    unlockForm.addEventListener("submit", handleUnlock);
    albumKeyInput.focus({ preventScroll: true });

    filterButtons.forEach((button) => {
      button.addEventListener("click", () => setFilter(button.dataset.filter));
    });

    lightboxClose.addEventListener("click", () => lightbox.close());
    lightboxPrev.addEventListener("click", () => stepLightbox(-1));
    lightboxNext.addEventListener("click", () => stepLightbox(1));
    lightbox.addEventListener("close", () => document.body.classList.remove("has-modal"));
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) lightbox.close();
    });
    lightbox.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") stepLightbox(-1);
      if (event.key === "ArrowRight") stepLightbox(1);
    });

    const updateHeader = () => {
      siteHeader.classList.toggle("is-scrolled", window.scrollY > 36);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      imageObserver?.disconnect();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
      albumCryptoKey = null;
    });
  }

  init();
})();
