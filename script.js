const API_KEY = 'ffca5c91378bf2d673b64968bd00ef90';
const BASE = 'https://api.openweathermap.org';

const $ = (sel) => document.querySelector(sel);

const searchInput = $('#searchInput');
const searchBtn = $('#searchBtn');
const geoBtn = $('#geoBtn');
const themeToggle = $('#themeToggle');
const unitToggle = $('#unitToggle');
const currentWeather = $('#currentWeather');
const hourlySection = $('#hourlySection');
const weeklySection = $('#weeklySection');
const trendSection = $('#trendSection');
const favSection = $('#favSection');
const loadingSpinner = $('#loadingSpinner');
const errorToast = $('#errorToast');
const recentSearches = $('#recentSearches');
const favCities = $('#favCities');
const favBtn = $('#favBtn');

let errorTimeout = null;
let isCelsius = localStorage.getItem('unit') !== 'f';
let weatherCondition = 800;
let currentLat = null, currentLon = null, currentCity = null;

function showLoading() { loadingSpinner.classList.remove('hidden'); }
function hideLoading() { loadingSpinner.classList.add('hidden'); }

function showError(msg) {
  if (errorTimeout) clearTimeout(errorTimeout);
  errorToast.textContent = msg;
  errorToast.classList.remove('hidden');
  errorTimeout = setTimeout(() => errorToast.classList.add('hidden'), 4000);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error('City not found');
    if (res.status === 429) throw new Error('Too many requests. Please wait.');
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

function getIconUrl(icon) {
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

function c(k) { return Math.round(k - 273.15); }
function f(k) { return Math.round((k - 273.15) * 9 / 5 + 32); }
function formatTemp(k) { return isCelsius ? `${c(k)}°` : `${f(k)}°`; }

function windSpeed(ms) {
  return isCelsius ? `${Math.round(ms * 3.6)} km/h` : `${Math.round(ms * 2.237)} mph`;
}

function windDir(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function calcDewPoint(tempK, humidity) {
  const t = tempK - 273.15;
  const a = 17.27, b = 237.7;
  const alpha = (a * t) / (b + t) + Math.log(humidity / 100);
  return (b * alpha) / (a - alpha);
}

function formatTime(unix) {
  const d = new Date(unix * 1000);
  let h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function setWeatherBg(code) {
  const body = document.body;
  body.classList.remove('bg-clear', 'bg-clouds', 'bg-rain', 'bg-drizzle', 'bg-thunderstorm', 'bg-snow', 'bg-atmosphere');
  if (code >= 200 && code < 300) body.classList.add('bg-thunderstorm');
  else if (code >= 300 && code < 400) body.classList.add('bg-drizzle');
  else if (code >= 500 && code < 600) body.classList.add('bg-rain');
  else if (code >= 600 && code < 700) body.classList.add('bg-snow');
  else if (code >= 700 && code < 800) body.classList.add('bg-atmosphere');
  else if (code === 800) body.classList.add('bg-clear');
  else if (code > 800) body.classList.add('bg-clouds');
}

const AQI_LABELS = { 1: 'Good', 2: 'Fair', 3: 'Moderate', 4: 'Poor', 5: 'Very Poor' };

function aqiColor(val) { return `var(--aqi-${val})`; }

// --- Theme ---
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  if (window._lastForecastData) renderTrendChart(window._lastForecastData);
});

// --- Unit toggle ---
unitToggle.addEventListener('click', () => {
  isCelsius = !isCelsius;
  localStorage.setItem('unit', isCelsius ? 'c' : 'f');
  document.querySelector('.unit-c').classList.toggle('active', isCelsius);
  document.querySelector('.unit-f').classList.toggle('active', !isCelsius);
  if (window._lastWeatherData) {
    renderCurrent(window._lastWeatherData, window._lastCityName);
    renderHourly(window._lastForecastData);
    renderWeekly(window._lastForecastData);
    renderTrendChart(window._lastForecastData);
  }
});

// --- Recent searches ---
function getRecent() {
  try { return JSON.parse(localStorage.getItem('recentCities')) || []; }
  catch { return []; }
}

function addRecent(city) {
  let list = getRecent().filter(c => c.toLowerCase() !== city.toLowerCase());
  list.unshift(city);
  if (list.length > 6) list = list.slice(0, 6);
  localStorage.setItem('recentCities', JSON.stringify(list));
  renderRecent();
}

function renderRecent() {
  const list = getRecent();
  if (!list.length) { recentSearches.innerHTML = ''; return; }
  recentSearches.innerHTML = list.map(c =>
    `<button class="recent-tag" data-city="${c}">${c}</button>`
  ).join('');
}

recentSearches.addEventListener('click', (e) => {
  const btn = e.target.closest('.recent-tag');
  if (btn) {
    searchInput.value = btn.dataset.city;
    doSearch(btn.dataset.city);
  }
});

// --- Favorites ---
function getFavs() {
  try { return JSON.parse(localStorage.getItem('favCities')) || []; }
  catch { return []; }
}

function isFav(city) {
  return getFavs().some(c => c.toLowerCase() === city.toLowerCase());
}

function toggleFav(city) {
  let list = getFavs();
  const idx = list.findIndex(c => c.toLowerCase() === city.toLowerCase());
  if (idx > -1) list.splice(idx, 1);
  else list.push(city);
  localStorage.setItem('favCities', JSON.stringify(list));
  renderFavs();
  if (city.toLowerCase() === (currentCity || '').toLowerCase()) {
    updateFavBtn();
  }
}

function updateFavBtn() {
  if (currentCity && isFav(currentCity)) {
    favBtn.textContent = '⭐';
    favBtn.classList.add('is-fav');
  } else {
    favBtn.textContent = '☆';
    favBtn.classList.remove('is-fav');
  }
}

favBtn.addEventListener('click', () => {
  if (currentCity) toggleFav(currentCity);
});

function renderFavs() {
  const list = getFavs();
  if (!list.length) { favSection.classList.add('hidden'); return; }
  favSection.classList.remove('hidden');
  favCities.innerHTML = list.map(c =>
    `<button class="fav-tag" data-city="${c}">${c}</button>`
  ).join('');
}

favCities.addEventListener('click', (e) => {
  const btn = e.target.closest('.fav-tag');
  if (btn) {
    searchInput.value = btn.dataset.city;
    doSearch(btn.dataset.city);
  }
});

// --- Search ---
async function doSearch(query) {
  if (!query.trim()) return;
  showLoading();
  try {
    const geo = await fetchJSON(`${BASE}/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1&appid=${API_KEY}`);
    if (!geo.length) throw new Error('City not found');
    const { lat, lon, name } = geo[0];
    addRecent(name);
    await loadWeather(lat, lon, name);
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
  }
}

// --- Main load ---
async function loadWeather(lat, lon, cityName) {
  currentLat = lat; currentLon = lon; currentCity = cityName;
  const [weatherData, forecastData, aqiData] = await Promise.all([
    fetchJSON(`${BASE}/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`),
    fetchJSON(`${BASE}/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}`),
    fetchJSON(`${BASE}/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`).catch(() => null)
  ]);
  window._lastWeatherData = weatherData;
  window._lastForecastData = forecastData;
  window._lastCityName = cityName;
  renderCurrent(weatherData, cityName, aqiData);
  renderHourly(forecastData);
  renderWeekly(forecastData);
  renderTrendChart(forecastData);
  currentWeather.classList.remove('hidden');
  hourlySection.classList.remove('hidden');
  weeklySection.classList.remove('hidden');
  trendSection.classList.remove('hidden');
  updateFavBtn();
}

// --- Render Current ---
function renderCurrent(data, cityName, aqiData) {
  weatherCondition = data.weather[0].id;
  setWeatherBg(weatherCondition);

  $('#cityName').textContent = cityName;
  $('#weatherDesc').textContent = data.weather[0].description;
  $('#currentTemp').textContent = formatTemp(data.main.temp);
  $('#weatherIcon').src = getIconUrl(data.weather[0].icon);
  $('#weatherIcon').alt = data.weather[0].description;
  $('#highTemp').textContent = formatTemp(data.main.temp_max);
  $('#lowTemp').textContent = formatTemp(data.main.temp_min);
  $('#feelsLike').textContent = formatTemp(data.main.feels_like);
  $('#humidity').textContent = `${data.main.humidity}%`;
  $('#windSpeed').textContent = windSpeed(data.wind.speed);
  $('#pressure').textContent = `${data.main.pressure} hPa`;
  $('#visibility').textContent = `${(data.visibility / 1000).toFixed(1)} km`;

  $('#windDirection').textContent = windDir(data.wind.deg || 0);
  $('#windGust').textContent = data.wind.gust ? windSpeed(data.wind.gust) : '—';

  const dp = calcDewPoint(data.main.temp, data.main.humidity);
  $('#dewPoint').textContent = formatTemp(dp + 273.15);
  $('#cloudCover').textContent = `${data.clouds.all}%`;
  $('#sunrise').textContent = formatTime(data.sys.sunrise);
  $('#sunset').textContent = formatTime(data.sys.sunset);

  // AQI
  const aqiEl = $('#aqi');
  if (aqiData && aqiData.list && aqiData.list[0]) {
    const val = aqiData.list[0].main.aqi;
    aqiEl.innerHTML = `<span class="aqi-badge"><span class="aqi-dot" style="background:${aqiColor(val)}"></span> ${val} — <span class="aqi-label">${AQI_LABELS[val]}</span></span>`;
  } else {
    aqiEl.textContent = '—';
  }

  // Feels like
  const diff = data.main.feels_like - data.main.temp;
  const feelEl = $('#feelsLikeCompare');
  if (Math.abs(diff) < 0.5) feelEl.textContent = '';
  else if (diff > 4) feelEl.textContent = `Feels ${Math.round(diff)}° warmer than actual`;
  else if (diff > 1) feelEl.textContent = 'Feels slightly warmer than actual';
  else if (diff < -4) feelEl.textContent = `Feels ${Math.round(Math.abs(diff))}° colder than actual`;
  else if (diff < -1) feelEl.textContent = 'Feels slightly colder than actual';
  else feelEl.textContent = '';

  const tempStr = isCelsius ? `${c(data.main.temp)}°C` : `${f(data.main.temp)}°F`;
  document.title = `${tempStr} | ${data.name} | Weatherly`;
}

// --- Hourly ---
function renderHourly(forecast) {
  const container = $('#hourlyForecast');
  const items = forecast.list.slice(0, 8);
  container.innerHTML = items.map(item => {
    const date = new Date(item.dt * 1000);
    const h = date.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const timeStr = `${h12}${ampm}`;
    const pop = Math.round(item.pop * 100);
    return `
      <div class="hourly-item">
        <span class="hourly-time">${timeStr}</span>
        <img class="hourly-icon" src="${getIconUrl(item.weather[0].icon)}" alt="${item.weather[0].description}" />
        <span class="hourly-temp">${formatTemp(item.main.temp)}</span>
        <span class="hourly-precip ${pop > 0 ? 'has-precip' : ''}">${pop}%</span>
      </div>
    `;
  }).join('');
}

// --- Weekly ---
function renderWeekly(forecast) {
  const container = $('#weeklyForecast');
  const days = {};
  forecast.list.forEach(item => {
    const date = new Date(item.dt * 1000);
    const key = date.toDateString();
    if (!days[key]) {
      days[key] = { highs: [], lows: [], icons: [], descs: [], pops: [] };
    }
    days[key].highs.push(item.main.temp_max);
    days[key].lows.push(item.main.temp_min);
    days[key].icons.push(item.weather[0].icon);
    days[key].descs.push(item.weather[0].description);
    days[key].pops.push(item.pop || 0);
  });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const entries = Object.entries(days).slice(0, 5);
  container.innerHTML = entries.map(([dateStr, d], i) => {
    const date = new Date(dateStr);
    const dayName = i === 0 ? 'Today' : dayNames[date.getDay()];
    const high = formatTemp(Math.max(...d.highs));
    const low = formatTemp(Math.min(...d.lows));
    const icon = d.icons[Math.floor(d.icons.length / 2)];
    const desc = d.descs[Math.floor(d.descs.length / 2)];
    const avgPop = Math.round(d.pops.reduce((a, b) => a + b, 0) / d.pops.length * 100);
    return `
      <div class="weekly-item">
        <span class="weekly-day">${dayName}</span>
        <span class="weekly-desc">
          <img src="${getIconUrl(icon)}" alt="${desc}" />
          ${desc}
        </span>
        <span class="weekly-precip">${avgPop}%</span>
        <span class="weekly-temps">
          <span class="weekly-high">${high}</span>
          <span class="weekly-low">${low}</span>
        </span>
      </div>
    `;
  }).join('');
}

// --- Temperature Trend Chart ---
function renderTrendChart(forecast) {
  const canvas = $('#tempChart');
  const ctx = canvas.getContext('2d');
  const wrapper = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;

  const rect = wrapper.getBoundingClientRect();
  const w = rect.width - 32;
  const h = 200;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const items = forecast.list.slice(0, 8);
  if (!items.length) return;

  const temps = items.map(i => i.main.temp);
  const minT = Math.min(...temps);
  const maxT = Math.max(...temps);
  const range = maxT - minT || 1;

  const pad = { top: 24, bottom: 36, left: 40, right: 20 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const getX = (i) => pad.left + (i / (items.length - 1)) * cw;
  const getY = (t) => pad.top + ch - ((t - minT) / range) * ch;

  ctx.clearRect(0, 0, w, h);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
  const lineColor = isDark ? '#6c63ff' : '#6c63ff';
  const fillGrad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  fillGrad.addColorStop(0, isDark ? 'rgba(108,99,255,0.25)' : 'rgba(108,99,255,0.2)');
  fillGrad.addColorStop(1, isDark ? 'rgba(108,99,255,0.02)' : 'rgba(108,99,255,0.02)');

  // Grid lines
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const y = pad.top + (ch / gridLines) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    const val = maxT - (range / gridLines) * i;
    ctx.fillStyle = textColor;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(isCelsius ? `${c(val)}°` : `${f(val)}°`, pad.left - 8, y + 4);
  }

  // Area fill
  ctx.beginPath();
  ctx.moveTo(getX(0), h - pad.bottom);
  temps.forEach((t, i) => {
    const x = getX(i);
    const y = getY(t);
    if (i === 0) ctx.lineTo(x, y);
    else {
      const prevX = getX(i - 1);
      const prevY = getY(temps[i - 1]);
      const cpX1 = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX1, prevY, cpX1, y, x, y);
    }
  });
  ctx.lineTo(getX(temps.length - 1), h - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Line
  ctx.beginPath();
  temps.forEach((t, i) => {
    const x = getX(i);
    const y = getY(t);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const prevX = getX(i - 1);
      const prevY = getY(temps[i - 1]);
      const cpX1 = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX1, prevY, cpX1, y, x, y);
    }
  });
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Points
  temps.forEach((t, i) => {
    const x = getX(i);
    const y = getY(t);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? '#0f0f1a' : '#f5f5fa';
    ctx.fill();
  });

  // X-axis labels
  items.forEach((item, i) => {
    const date = new Date(item.dt * 1000);
    const h = date.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    ctx.fillStyle = textColor;
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${h12}${ampm}`, getX(i), h - 6);
  });
}

// --- Geolocation ---
geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showError('Geolocation not supported');
    return;
  }
  showLoading();
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const data = await fetchJSON(`${BASE}/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
        await loadWeather(lat, lon, data.name);
      } catch (err) {
        showError(err.message);
      } finally {
        hideLoading();
      }
    },
    () => {
      hideLoading();
      showError('Location access denied');
    },
    { timeout: 10000, enableHighAccuracy: false }
  );
});

// --- Events ---
searchBtn.addEventListener('click', () => doSearch(searchInput.value));
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(searchInput.value);
});

// --- Placeholder rotation ---
const placeholders = ['Search city...', 'e.g. London', 'e.g. Tokyo', 'e.g. New York', 'e.g. Paris', 'e.g. Dubai', 'e.g. Singapore'];
let phIndex = 0;
setInterval(() => {
  phIndex = (phIndex + 1) % placeholders.length;
  searchInput.placeholder = placeholders[phIndex];
}, 3000);

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') { e.target.blur(); }
    return;
  }
  switch (e.key) {
    case '/':
    case 's':
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      break;
    case 'g':
      geoBtn.click();
      break;
    case 't':
      themeToggle.click();
      break;
    case 'u':
      unitToggle.click();
      break;
    case 'Escape':
      searchInput.blur();
      errorToast.classList.add('hidden');
      break;
  }
});

// --- Init unit ---
if (isCelsius) {
  document.querySelector('.unit-c').classList.add('active');
} else {
  document.querySelector('.unit-f').classList.add('active');
}

// --- Window resize ---
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window._lastForecastData) renderTrendChart(window._lastForecastData);
  }, 200);
});

// --- PWA ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- Init ---
renderRecent();
renderFavs();

document.addEventListener('DOMContentLoaded', () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          const data = await fetchJSON(`${BASE}/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}`);
          await loadWeather(lat, lon, data.name);
        } catch { /* silent */ }
      },
      () => { /* denied */ },
      { timeout: 5000, enableHighAccuracy: false }
    );
  }
});
