// Keep the wrapped, inverted image intact. Older WebKit gets a clipping frame
// instead of object-view-box; cropping never creates a new raster image.
(() => {
  if (CSS.supports('object-view-box', 'inset(1px)')) return;

  const selector = 'img.lg-image, .lg-thumb-item img, .album-card img';
  const images = new Map();

  function reportFailure(error) {
    console.error('Could not display gallery photograph', error);
    const status = document.querySelector('.gallery-status');
    if (status) status.textContent = 'Sorry, this photograph could not be loaded.';
  }

  function layout(state) {
    const { image, frame, host, kind, top, left, width, height } = state;
    let frameWidth = host.clientWidth;
    let frameHeight = kind === 'cover' ? frameWidth * 3 / 4 : host.clientHeight;
    const scale = kind === 'gallery'
      ? Math.min(frameWidth / width, frameHeight / height, 1)
      : Math.max(frameWidth / width, frameHeight / height);
    if (kind === 'gallery') {
      frameWidth = width * scale;
      frameHeight = height * scale;
    }
    frame.style.width = `${frameWidth}px`;
    frame.style.height = `${frameHeight}px`;
    image.style.width = `${image.naturalWidth * scale}px`;
    image.style.height = `${image.naturalHeight * scale}px`;
    image.style.left = `${(frameWidth - width * scale) / 2 - left * scale}px`;
    image.style.top = `${(frameHeight - height * scale) / 2 - top * scale}px`;
  }

  function crop(image) {
    if (!image.matches(selector) || !image.complete || !image.naturalWidth) return;
    const insets = getComputedStyle(image).getPropertyValue('--photo-crop')
      .trim().split(/\s+/).map(value => Number(value.replace(/px$/, '')));
    if (insets.length !== 4 || !insets.every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error('Invalid photograph crop');
    }
    const [top, right, bottom, left] = insets;
    const width = image.naturalWidth - left - right;
    const height = image.naturalHeight - top - bottom;
    if (width <= 0 || height <= 0) throw new Error('Empty photograph crop');

    let state = images.get(image);
    if (!state) {
      const frame = document.createElement('span');
      frame.className = 'photo-crop-frame';
      const host = image.parentElement;
      const kind = image.matches('img.lg-image') ? 'gallery'
        : image.closest('.lg-thumb-item') ? 'thumbnail' : 'cover';
      image.before(frame);
      frame.append(image);
      state = { image, frame, host, kind };
      state.observer = new ResizeObserver(() => layout(state));
      state.observer.observe(host);
      images.set(image, state);
    }
    Object.assign(state, { top, left, width, height });
    layout(state);
    image.setAttribute('data-crop-ready', '');
  }

  document.addEventListener('load', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    try { crop(image); } catch (error) { reportFailure(error); }
  }, true);

  document.addEventListener('error', event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.matches(selector)) {
      reportFailure(new Error('Photograph image failed to load'));
    }
  }, true);

  // LightGallery removes off-screen slides. Release their observers/references
  // and hide a reused image until the replacement's own insets are applied.
  new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') mutation.target.removeAttribute('data-crop-ready');
    }
    for (const [image, state] of images) {
      if (!image.isConnected) {
        state.observer.disconnect();
        images.delete(image);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
})();
