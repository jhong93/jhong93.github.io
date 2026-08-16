const state = {
  flights: [],
  filtered: [],
  airports: {},
  world: null,
  visible: 50,
};

const $ = (selector) => document.querySelector(selector);
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function codeOptions(codes) {
  return codes.map((code) => {
    const airport = state.airports[code];
    const label = airport ? `${airport.name} · ${airport.city || airport.country}` : code;
    return `<option value="${code}">${escapeHtml(label)}</option>`;
  }).join("");
}

function initializeFilters(metadata) {
  const origins = [...new Set(state.flights.flatMap((flight) => flight.origin_airport_codes))].sort();
  const destinations = [...new Set(state.flights.flatMap((flight) => flight.destination_airport_codes))].sort();
  $("#origin-options").innerHTML = codeOptions(origins);
  $("#destination-options").innerHTML = codeOptions(destinations);

  const years = [...new Set(state.flights.map((flight) => flight.year))].sort((a, b) => a - b);
  const defaultStart = years.includes(2020) ? 2020 : years[0];
  $("#year-from").innerHTML = years.map((year) => `<option value="${year}" ${year === defaultStart ? "selected" : ""}>${year}</option>`).join("");
  $("#year-to").insertAdjacentHTML("beforeend", [...years].reverse().map((year) => `<option value="${year}">${year}</option>`).join(""));

  $("#hero-count").textContent = integer.format(metadata.coded_route_count);
  $("#archive-range").textContent = `${metadata.date_range.start.slice(0, 4)}—${metadata.date_range.end.slice(0, 4)} · IATA routes`;
}

function selectedCodes() {
  const originValue = $("#origin").value.trim().toUpperCase();
  return {
    origins: [...new Set(originValue.match(/[A-Z]{3}/g) || [])],
    originValue,
    destination: $("#destination").value.trim().toUpperCase(),
  };
}

function applyUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  $("#origin").value = (params.get("from") || "SFO,SJC").toUpperCase().replace(/[^A-Z,\s]/g, "");
  $("#destination").value = (params.get("to") || "").toUpperCase().slice(0, 3);
}

function syncUrl(origins, destination) {
  const params = new URLSearchParams(window.location.search);
  origins.length ? params.set("from", origins.join(",")) : params.delete("from");
  destination ? params.set("to", destination) : params.delete("to");
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function filterFlights() {
  const { origins, originValue, destination } = selectedCodes();
  syncUrl(origins, destination);
  $("#swap-button").disabled = origins.length > 1;
  $("#swap-button").title = origins.length > 1 ? "Swap is available with one origin airport" : "Swap origin and destination";
  const yearFrom = Number($("#year-from").value);
  const yearTo = Number($("#year-to").value) || Number.POSITIVE_INFINITY;

  state.filtered = state.flights.filter((flight) => {
    if (!flight.origin_code || !flight.destination_code) return false;
    if (originValue && !origins.length) return false;
    const direct = (!origins.length || origins.some((code) => flight.origin_airport_codes.includes(code)))
      && (!destination || flight.destination_airport_codes.includes(destination));
    const reverse = flight.bidirectional
      && (!origins.length || origins.some((code) => flight.destination_airport_codes.includes(code)))
      && (!destination || flight.origin_airport_codes.includes(destination));
    return (direct || reverse)
      && (!yearFrom || flight.year >= yearFrom)
      && flight.year <= yearTo;
  });

  sortFlights();
  state.visible = 50;
  render();
}

function sortFlights() {
  const sort = $("#sort").value;
  state.filtered.sort((a, b) => {
    if (sort === "newest") return b.date.localeCompare(a.date) || a.price - b.price;
    if (sort === "oldest") return a.date.localeCompare(b.date) || a.price - b.price;
    return a.price - b.price || b.date.localeCompare(a.date);
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted, percentile) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined
    ? sorted[lower]
    : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function renderBoxPlot() {
  const container = $("#box-plot");
  const values = state.filtered.map((flight) => flight.price).sort((a, b) => a - b);
  if (!values.length) {
    container.innerHTML = '<div class="box-plot-empty">No matching fares to summarize.</div>';
    return;
  }

  const q1 = quantile(values, 0.25);
  const med = quantile(values, 0.5);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const lowerWhisker = values.find((value) => value >= lowerFence) ?? values[0];
  const upperWhisker = [...values].reverse().find((value) => value <= upperFence) ?? values.at(-1);
  const outliers = values.filter((value) => value < lowerWhisker || value > upperWhisker);
  const maximum = Math.max(values.at(-1), upperWhisker, 1);
  const width = 1000;
  const height = 126;
  const left = 48;
  const right = 18;
  const plotWidth = width - left - right;
  const x = (value) => left + (value / maximum) * plotWidth;
  const ticks = Array.from({ length: 5 }, (_, index) => (maximum / 4) * index);
  const sampledOutliers = outliers.length <= 60
    ? outliers
    : Array.from({ length: 60 }, (_, index) => outliers[Math.floor((index / 59) * (outliers.length - 1))]);

  container.setAttribute(
    "aria-label",
    `Fare distribution: first quartile ${currency.format(q1)}, median ${currency.format(med)}, third quartile ${currency.format(q3)}.`,
  );
  $("#distribution-note").textContent = `${integer.format(values.length)} fares · ${integer.format(outliers.length)} outliers`;
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      ${ticks.map((tick) => `<line class="tick-line" x1="${x(tick)}" y1="18" x2="${x(tick)}" y2="96"/><text text-anchor="middle" x="${x(tick)}" y="120">${currency.format(tick)}</text>`).join("")}
      <line class="axis-line" x1="${left}" y1="86" x2="${width - right}" y2="86"/>
      <line class="whisker-line" x1="${x(lowerWhisker)}" y1="57" x2="${x(upperWhisker)}" y2="57"/>
      <line class="whisker-cap" x1="${x(lowerWhisker)}" y1="41" x2="${x(lowerWhisker)}" y2="73"/>
      <line class="whisker-cap" x1="${x(upperWhisker)}" y1="41" x2="${x(upperWhisker)}" y2="73"/>
      <rect class="quartile-box" x="${x(q1)}" y="34" width="${Math.max(1, x(q3) - x(q1))}" height="46"/>
      <line class="median-line" x1="${x(med)}" y1="34" x2="${x(med)}" y2="80"/>
      ${sampledOutliers.map((value, index) => `<circle class="outlier" cx="${x(value)}" cy="${21 + (index % 4) * 6}" r="2.2"><title>Outlier: ${currency.format(value)}</title></circle>`).join("")}
      <text class="value-label" text-anchor="middle" x="${x(q1)}" y="29">Q1 ${currency.format(q1)}</text>
      <text class="value-label" text-anchor="middle" x="${x(med)}" y="92">Median ${currency.format(med)}</text>
      <text class="value-label" text-anchor="middle" x="${x(q3)}" y="29">Q3 ${currency.format(q3)}</text>
    </svg>`;
}

function renderScatterPlot() {
  const container = $("#scatter-plot");
  const canvas = $("#scatter-canvas");
  const flights = state.filtered
    .map((flight) => ({ date: Date.parse(`${flight.date}T00:00:00Z`), price: flight.price }))
    .filter((point) => Number.isFinite(point.date) && Number.isFinite(point.price))
    .sort((a, b) => a.date - b.date);

  if (!flights.length) {
    canvas.hidden = true;
    let empty = container.querySelector(".scatter-plot-empty");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "scatter-plot-empty";
      empty.textContent = "No matching fares to plot.";
      container.appendChild(empty);
    }
    return;
  }

  container.querySelector(".scatter-plot-empty")?.remove();
  canvas.hidden = false;
  const cssWidth = Math.max(320, container.clientWidth);
  const cssHeight = 270;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { top: 18, right: 17, bottom: 35, left: 54 };
  const plotWidth = cssWidth - padding.left - padding.right;
  const plotHeight = cssHeight - padding.top - padding.bottom;
  const minDate = flights[0].date;
  const maxDate = flights.at(-1).date;
  const dateRange = Math.max(86_400_000, maxDate - minDate);
  const maximumPrice = Math.max(...flights.map((point) => point.price), 1);
  const yMaximum = Math.ceil(maximumPrice / 100) * 100 || 100;
  const x = (date) => padding.left + ((date - minDate) / dateRange) * plotWidth;
  const y = (price) => padding.top + (1 - price / yMaximum) * plotHeight;

  context.strokeStyle = "#d5e5ed";
  context.fillStyle = "#607b91";
  context.lineWidth = 1;
  context.font = '9px "DM Mono", monospace';
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const price = (yMaximum / 4) * index;
    const yPosition = y(price);
    context.beginPath();
    context.moveTo(padding.left, yPosition);
    context.lineTo(cssWidth - padding.right, yPosition);
    context.stroke();
    context.textAlign = "right";
    context.fillText(currency.format(price), padding.left - 7, yPosition);
  }

  const dateLabel = (timestamp) => new Intl.DateTimeFormat("en-US", {
    month: dateRange < 946_080_000_00 ? "short" : undefined,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
  context.textBaseline = "alphabetic";
  for (let index = 0; index <= 4; index += 1) {
    const timestamp = minDate + (dateRange / 4) * index;
    const xPosition = x(timestamp);
    context.beginPath();
    context.moveTo(xPosition, padding.top);
    context.lineTo(xPosition, padding.top + plotHeight);
    context.stroke();
    context.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
    context.fillText(dateLabel(timestamp), xPosition, cssHeight - 10);
  }

  const limit = 15_000;
  const points = flights.length <= limit
    ? flights
    : Array.from({ length: limit }, (_, index) => flights[Math.floor((index / (limit - 1)) * (flights.length - 1))]);
  context.fillStyle = "rgba(22, 138, 173, .30)";
  points.forEach((point) => {
    context.beginPath();
    context.arc(x(point.date), y(point.price), 1.65, 0, Math.PI * 2);
    context.fill();
  });

  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#168bff";
  context.lineWidth = 1.25;
  const minimum = flights.reduce((best, point) => point.price < best.price ? point : best, flights[0]);
  context.beginPath();
  context.arc(x(minimum.date), y(minimum.price), 4, 0, Math.PI * 2);
  context.stroke();

  const startLabel = dateLabel(minDate);
  const endLabel = dateLabel(maxDate);
  $("#scatter-note").textContent = `${integer.format(flights.length)} deals · ${startLabel}—${endLabel}`;
  container.setAttribute(
    "aria-label",
    `Scatter plot of ${integer.format(flights.length)} fares from ${startLabel} through ${endLabel}, ranging up to ${currency.format(maximumPrice)}.`,
  );
}

function renderSummary() {
  const best = state.filtered.reduce((current, flight) => !current || flight.price < current.price ? flight : current, null);
  const routes = new Set(state.filtered.filter((flight) => flight.route !== "UNRESOLVED").map((flight) => flight.route));
  $("#best-price").textContent = best ? currency.format(best.price) : "—";
  $("#best-route").textContent = best ? `${best.route} · ${best.month_name} ${best.year}` : "No matching fares";
  $("#match-count").textContent = integer.format(state.filtered.length);
  $("#route-count").textContent = `${integer.format(routes.size)} coded routes`;
  const middle = median(state.filtered.map((flight) => flight.price));
  $("#median-price").textContent = middle === null ? "—" : currency.format(middle);
}

function project(longitude, latitude, width, height) {
  return [((longitude + 180) / 360) * width, ((90 - latitude) / 180) * height];
}

function ringPath(ring, width, height) {
  return ring.map(([longitude, latitude], index) => {
    const [x, y] = project(longitude, latitude, width, height);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

function geometryPath(geometry, width, height) {
  if (geometry.type === "Polygon") return geometry.coordinates.map((ring) => ringPath(ring, width, height)).join(" ");
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => ringPath(ring, width, height))).join(" ");
  return "";
}

function arcPath(origin, destination, width, height) {
  const [x1, y1] = project(origin.longitude, origin.latitude, width, height);
  const [x2, y2] = project(destination.longitude, destination.latitude, width, height);
  const curve = Math.min(95, Math.max(20, Math.abs(x2 - x1) * 0.16));
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${((x1 + x2) / 2).toFixed(1)},${(Math.min(y1, y2) - curve).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

function mappedRoutes(originCodes, destinationCode) {
  const routes = new Map();
  state.filtered.forEach((flight) => {
    originCodes.forEach((originCode) => {
      let candidates = flight.destination_airport_codes;
      let isReverse = false;
      if (!flight.origin_airport_codes.includes(originCode) && flight.bidirectional && flight.destination_airport_codes.includes(originCode)) {
        candidates = flight.origin_airport_codes;
        isReverse = true;
      }
      if (!flight.origin_airport_codes.includes(originCode) && !isReverse) return;
      const code = destinationCode && candidates.includes(destinationCode) ? destinationCode : candidates[0];
      if (!code || code === originCode || !state.airports[code]) return;
      const key = `${originCode}:${code}`;
      const current = routes.get(key);
      if (!current || flight.price < current.flight.price) routes.set(key, { originCode, code, flight });
    });
  });
  return [...routes.values()].sort((a, b) => a.flight.price - b.flight.price).slice(0, 100);
}

function mapOriginChoices(destinationCode) {
  const yearFrom = Number($("#year-from").value);
  const yearTo = Number($("#year-to").value) || Number.POSITIVE_INFINITY;
  const counts = new Map();
  state.flights.forEach((flight) => {
    if (!flight.origin_code || flight.year < yearFrom || flight.year > yearTo) return;
    const direct = !destinationCode || flight.destination_airport_codes.includes(destinationCode);
    const reverse = flight.bidirectional && (!destinationCode || flight.origin_airport_codes.includes(destinationCode));
    if (!direct && !reverse) return;
    const codes = reverse && !direct ? flight.destination_airport_codes : flight.origin_airport_codes;
    const code = codes[0];
    if (!code || !state.airports[code]) return;
    counts.set(code, (counts.get(code) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 35);
}

function originChoiceMarkup(code, count, selected, width, height, showLabel = true) {
  const airport = state.airports[code];
  const [x, y] = project(airport.longitude, airport.latitude, width, height);
  const radius = selected ? 6 : Math.min(5, 2.7 + Math.log10(count + 1));
  return `<g class="origin-choice" data-origin-code="${code}" tabindex="0" role="button" aria-label="Search from ${code}, ${escapeHtml(airport.name)}">
    <circle class="${selected ? "origin-dot" : "origin-choice-dot"}" cx="${x}" cy="${y}" r="${radius}"><title>Use ${code} as origin · ${escapeHtml(airport.name)}</title></circle>
    ${showLabel ? `<text class="airport-label" x="${x + radius + 4}" y="${y - radius}">${code}</text>` : ""}
  </g>`;
}

function renderMap() {
  const container = $("#route-map");
  if (!state.world) {
    container.innerHTML = '<div class="map-loading">Loading airport map…</div>';
    return;
  }

  const width = 1100;
  const height = 455;
  const countries = state.world.features.map((feature) => `<path class="country" d="${geometryPath(feature.geometry, width, height)}"></path>`).join("");
  const { origins, destination } = selectedCodes();
  const validOrigins = origins.filter((code) => state.airports[code]);
  const originChoices = mapOriginChoices(destination);
  let overlay = "";

  if (validOrigins.length) {
    const routes = mappedRoutes(validOrigins, destination);
    overlay += originChoices
      .filter(([code]) => !validOrigins.includes(code))
      .map(([code, count], index) => originChoiceMarkup(code, count, false, width, height, index < 18))
      .join("");
    overlay += routes.map(({ originCode, code, flight }, index) => {
      const originAirport = state.airports[originCode];
      const airport = state.airports[code];
      return `<path class="route-arc ${index < 8 ? "active" : ""}" d="${arcPath(originAirport, airport, width, height)}"><title>${originCode} → ${code}: ${currency.format(flight.price)} minimum</title></path>`;
    }).join("");
    const destinations = new Map();
    routes.forEach(({ code, flight }) => {
      const current = destinations.get(code);
      if (!current || flight.price < current.price) destinations.set(code, flight);
    });
    overlay += [...destinations.entries()].map(([code, flight], index) => {
      const airport = state.airports[code];
      const [x, y] = project(airport.longitude, airport.latitude, width, height);
      return `<g><circle class="airport-dot" cx="${x}" cy="${y}" r="${index < 10 ? 3.6 : 2.5}"><title>${code} · ${airport.name}\nLowest: ${currency.format(flight.price)}</title></circle>${index < 12 ? `<text class="airport-label" x="${x + 6}" y="${y - 6}">${code}</text>` : ""}</g>`;
    }).join("");
    overlay += validOrigins.map((originCode) => originChoiceMarkup(originCode, 1, true, width, height)).join("");
    $("#map-focus").textContent = validOrigins.length === 1
      ? `${validOrigins[0]} · ${state.airports[validOrigins[0]].name}`
      : `${validOrigins.join(", ")} · ${validOrigins.length} origin airports`;
    $("#map-note").textContent = destination
      ? `Showing historical route to ${destination}. Click an origin dot to change airport.`
      : "Cheapest historical fare to each destination. Click an origin dot to change airport.";
    $("#mapped-routes").textContent = integer.format(routes.length);
    $("#mapped-low").textContent = routes.length ? currency.format(routes[0].flight.price) : "—";
  } else if (origins.length) {
    $("#map-focus").textContent = `Unknown airport code${origins.length > 1 ? "s" : ""}`;
    $("#map-note").textContent = "Check the selected three-letter IATA codes.";
    $("#mapped-routes").textContent = "0";
    $("#mapped-low").textContent = "—";
  } else {
    const busiest = originChoices;
    overlay = busiest.map(([code, count], index) => originChoiceMarkup(code, count, false, width, height, index < 18)).join("");
    $("#map-focus").textContent = "All coded origin airports";
    $("#map-note").textContent = "Click an origin dot or enter an airport code above.";
    $("#mapped-routes").textContent = integer.format(busiest.length);
    $("#mapped-low").textContent = "—";
  }

  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><g>${countries}</g><g>${overlay}</g></svg>`;
}

function renderResults() {
  const rows = state.filtered.slice(0, state.visible).map((flight) => {
    const airportNames = (codes) => (codes || "").split("/").map((code) => state.airports[code]?.name || code).join(" / ");
    const airportDetail = flight.origin_code && flight.destination_code
      ? `${airportNames(flight.origin_code)} → ${airportNames(flight.destination_code)}`
      : `Source label: ${flight.source_route || "Unavailable"}`;
    return `
      <tr>
        <td><span class="route-name ${flight.route === "UNRESOLVED" ? "unresolved" : ""}">${escapeHtml(flight.route)}</span><span class="route-detail" title="${escapeHtml(flight.title)}">${escapeHtml(airportDetail)} · Source: ${escapeHtml(flight.source_route || "—")}</span></td>
        <td class="carrier">${escapeHtml(flight.carrier || "—")}</td>
        <td class="published">${dateFormat.format(new Date(`${flight.date}T00:00:00Z`))}</td>
        <td class="fare">${currency.format(flight.price)}</td>
        <td><a class="deal-link" href="${escapeHtml(flight.url)}" target="_blank" rel="noreferrer" aria-label="Open original deal for ${escapeHtml(flight.route)}">✈</a></td>
      </tr>`;
  }).join("");
  $("#results-body").innerHTML = rows;
  $("#empty-state").hidden = state.filtered.length > 0;
  const loadMore = $("#load-more");
  loadMore.hidden = state.visible >= state.filtered.length;
  loadMore.textContent = `Show more fares (${integer.format(Math.max(0, state.filtered.length - state.visible))} remaining)`;
}

function render() {
  renderSummary();
  renderMap();
  renderBoxPlot();
  renderScatterPlot();
  renderResults();
}

function debounce(callback, delay = 140) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptDatabase(envelope, password) {
  if (envelope.format !== "fare-atlas-encrypted-v1"
    || envelope.compression !== "gzip"
    || envelope.cipher?.name !== "AES-GCM"
    || envelope.kdf?.name !== "PBKDF2") {
    throw new Error("Unsupported encrypted archive format");
  }

  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: envelope.kdf.hash,
      salt: decodeBase64(envelope.kdf.salt),
      iterations: envelope.kdf.iterations,
    },
    passwordMaterial,
    { name: "AES-GCM", length: envelope.cipher.key_bits },
    false,
    ["decrypt"],
  );
  const compressed = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(envelope.cipher.iv) },
    key,
    decodeBase64(envelope.ciphertext),
  );
  const decompressed = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(decompressed).json();
}

async function unlockArchive(password) {
  const status = $("#unlock-status");
  const button = $("#unlock-button");
  status.classList.remove("error");
  status.textContent = "Decrypting archive…";
  button.disabled = true;

  try {
    const [databaseResponse, worldResponse] = await Promise.all([fetch("flights.json"), fetch("world.geojson")]);
    if (!databaseResponse.ok) throw new Error(`Fare database: HTTP ${databaseResponse.status}`);
    if (!worldResponse.ok) throw new Error(`Map data: HTTP ${worldResponse.status}`);
    const [envelope, world] = await Promise.all([databaseResponse.json(), worldResponse.json()]);
    const database = await decryptDatabase(envelope, password);
    if (!Array.isArray(database.flights) || !database.airports || !database.metadata) {
      throw new Error("Invalid decrypted database");
    }

    state.flights = database.flights;
    state.airports = database.airports;
    state.world = world;
    initializeFilters(database.metadata);
    applyUrlFilters();
    filterFlights();

    $("#unlock-key").value = "";
    $("#page-shell").inert = false;
    $("#page-shell").setAttribute("aria-hidden", "false");
    document.body.classList.remove("locked");
    $("#unlock-overlay").hidden = true;
    $("#origin").focus();
  } catch (error) {
    console.error("Could not unlock archive", error);
    status.classList.add("error");
    status.textContent = error.message.includes("HTTP") || error.message.includes("format")
      ? `Could not load the archive. ${error.message}`
      : "Incorrect key or damaged archive. Please try again.";
    $("#unlock-key").select();
  } finally {
    button.disabled = false;
  }
}

function start() {
  const status = $("#unlock-status");
  if (!window.crypto?.subtle || typeof DecompressionStream === "undefined") {
    status.classList.add("error");
    status.textContent = "This browser cannot decrypt the archive. Please use a current browser.";
    $("#unlock-button").disabled = true;
    return;
  }
  $("#unlock-key").focus();
}

const debouncedFilter = debounce(filterFlights);
$("#unlock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  unlockArchive($("#unlock-key").value);
});
$("#filter-form").addEventListener("input", debouncedFilter);
$("#filter-form").addEventListener("change", filterFlights);
$("#origin").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z,\s]/g, "");
});
$("#destination").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
});
$("#sort").addEventListener("change", () => { sortFlights(); renderResults(); });
$("#swap-button").addEventListener("click", () => {
  if (selectedCodes().origins.length > 1) return;
  const origin = $("#origin").value;
  $("#origin").value = $("#destination").value;
  $("#destination").value = origin;
  filterFlights();
});
$("#reset-button").addEventListener("click", () => { $("#filter-form").reset(); filterFlights(); });
$("#load-more").addEventListener("click", () => { state.visible += 50; renderResults(); });
$("#route-map").addEventListener("click", (event) => {
  const choice = event.target.closest("[data-origin-code]");
  if (!choice) return;
  $("#origin").value = choice.dataset.originCode;
  filterFlights();
});
$("#route-map").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const choice = event.target.closest("[data-origin-code]");
  if (!choice) return;
  event.preventDefault();
  $("#origin").value = choice.dataset.originCode;
  filterFlights();
});
window.addEventListener("resize", debounce(renderScatterPlot, 180));

start();
