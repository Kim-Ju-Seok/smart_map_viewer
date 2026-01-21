const SHEET_ID = "1mQqRfEPugyBIE7YnqDn6FbUFQzZ1zQtn6k1aNNqlwP0";
const SHEET_NAME = "RAW";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

const mapStatus = document.getElementById("map-status");
const listCount = document.getElementById("list-count");
const tableBody = document.getElementById("table-body");
const chart = document.getElementById("chart");
const chartRange = document.getElementById("chart-range");
const statTotal = document.getElementById("stat-total");
const statWeek = document.getElementById("stat-week");
const statToday = document.getElementById("stat-today");

const dateStart = document.getElementById("date-start");
const dateEnd = document.getElementById("date-end");
const searchText = document.getElementById("search-text");
const resetBtn = document.getElementById("reset-btn");
const pathChecks = Array.from(document.querySelectorAll(".chip input"));

let rawRows = [];
let map;
let markers = [];
let overlays = [];

const geocodeCache = JSON.parse(localStorage.getItem("dong-geocode") || "{}");

function parseCsv(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const result = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      rows.push(current);
      current = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      rows.push(current);
      result.push(rows.splice(0));
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length || rows.length) {
    rows.push(current);
    result.push(rows);
  }
  return result;
}

function normalizeDate(input) {
  if (!input) return "";
  const trimmed = input.trim();
  const datePart = trimmed.split(" ")[0];
  const parts = datePart.split(/[./-]/).map((v) => v.trim()).filter(Boolean);
  if (parts.length < 3) return "";
  const [year, month, day] = parts;
  if (!year || !month || !day) return "";
  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractDong(address) {
  if (!address) return "";
  const tokens = address.split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].endsWith("동")) return tokens[i];
  }
  return "";
}

function buildFilterState() {
  const activePaths = pathChecks.filter((el) => el.checked).map((el) => el.value);
  const keyword = searchText.value.trim().toLowerCase();
  return {
    activePaths,
    keyword,
    start: dateStart.value,
    end: dateEnd.value,
  };
}

function applyFilters(rows) {
  const { activePaths, keyword, start, end } = buildFilterState();
  return rows.filter((row) => {
    if (!activePaths.includes(row.offlinePath)) return false;
    if (keyword) {
      const hay = `${row.dong} ${row.offlinePath} ${row.region} ${row.school}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    return true;
  });
}

function groupBy(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function updateStats(rows) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  statTotal.textContent = rows.length.toLocaleString();
  statToday.textContent = rows.filter((r) => r.date === today).length.toLocaleString();
  statWeek.textContent = rows.filter((r) => r.date >= weekAgo).length.toLocaleString();
}

function updateTable(rows) {
  const grouped = groupBy(rows, (row) => `${row.date}|${row.dong}|${row.offlinePath}|${row.region}`);
  const entries = Array.from(grouped.entries())
    .map(([key, count]) => {
      const [date, dong, offlinePath, region] = key.split("|");
      return { date, dong, offlinePath, region, count };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  tableBody.innerHTML = entries
    .map((row) => {
      return `
        <tr>
          <td>${row.date}</td>
          <td>${row.dong}</td>
          <td>${row.offlinePath}</td>
          <td>${row.region}</td>
          <td>${row.count}</td>
        </tr>
      `;
    })
    .join("");
  listCount.textContent = `${entries.length} 그룹`;
}

function updateChart(rows) {
  const grouped = groupBy(rows, (row) => row.date);
  const entries = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  chart.innerHTML = "";

  const max = Math.max(...entries.map(([, value]) => value), 1);
  entries.forEach(([date, value]) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${(value / max) * 100}%`;
    bar.innerHTML = `<span>${date} · ${value}</span>`;
    chart.appendChild(bar);
  });

  if (entries.length) {
    chartRange.textContent = `${entries[0][0]} ~ ${entries[entries.length - 1][0]}`;
  } else {
    chartRange.textContent = "-";
  }
}

function clearMarkers() {
  markers.forEach((marker) => marker.setMap(null));
  overlays.forEach((overlay) => overlay.setMap(null));
  markers = [];
  overlays = [];
}

function createBubbleOverlay(position, count) {
  return new naver.maps.CustomOverlay({
    position,
    content: `
      <div style="
        background: rgba(255,106,61,0.95);
        color: #120903;
        font-weight: 700;
        font-size: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        box-shadow: 0 10px 20px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.4);
      ">${count}</div>
    `,
    yAnchor: 1,
  });
}

async function geocodeDong(query) {
  if (geocodeCache[query]) return geocodeCache[query];
  return new Promise((resolve) => {
    naver.maps.Service.geocode({ query }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK || !response.v2.addresses.length) {
        resolve(null);
        return;
      }
      const address = response.v2.addresses[0];
      const coords = { lat: parseFloat(address.y), lng: parseFloat(address.x) };
      geocodeCache[query] = coords;
      localStorage.setItem("dong-geocode", JSON.stringify(geocodeCache));
      resolve(coords);
    });
  });
}

async function updateMap(rows) {
  clearMarkers();
  const grouped = groupBy(rows, (row) => `${row.region}|${row.dong}`);
  const entries = Array.from(grouped.entries());

  if (!entries.length) {
    mapStatus.textContent = "표시할 데이터 없음";
    return;
  }

  mapStatus.textContent = "좌표 계산 중...";

  for (const [key, count] of entries) {
    const [region, dong] = key.split("|");
    if (!dong) continue;
    const query = `${region} ${dong}`.trim();
    const coords = await geocodeDong(query);
    if (!coords) continue;
    const position = new naver.maps.LatLng(coords.lat, coords.lng);
    const marker = new naver.maps.Marker({ position, map });
    const overlay = createBubbleOverlay(position, count);
    overlay.setMap(map);
    markers.push(marker);
    overlays.push(overlay);
  }

  mapStatus.textContent = "";
}

function refreshView() {
  const filtered = applyFilters(rawRows);
  updateStats(filtered);
  updateTable(filtered);
  updateChart(filtered);
  updateMap(filtered);
}

function setDefaultDates(rows) {
  if (!rows.length) return;
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  dateStart.value = dates[0];
  dateEnd.value = dates[dates.length - 1];
}

function initMap() {
  map = new naver.maps.Map("map", {
    center: new naver.maps.LatLng(35.1595, 126.8526),
    zoom: 11,
    mapTypeControl: false,
  });
}

async function loadData() {
  mapStatus.textContent = "데이터 불러오는 중...";
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error("CSV fetch failed");
    const csvText = await response.text();
    const rows = parseCsv(csvText);
    const headers = rows.shift();

    rawRows = rows.map((row) => {
      const data = Object.fromEntries(headers.map((header, idx) => [header, row[idx] || ""]));
      const offline = (data["신청경로 (오프라인)"] || "").trim();
      let offlinePath = offline;
      if (!offlinePath) offlinePath = "기타";
      if (offlinePath.includes("포스터")) offlinePath = "포스터";
      if (offlinePath.includes("정류장")) offlinePath = "정류장";
      const address = data["실 거주지 주소"] || "";
      const dong = extractDong(address);
      return {
        date: normalizeDate(data["일시"]),
        region: (data["수강지역"] || "").trim(),
        offlinePath,
        dong,
        school: (data["학교/학과"] || "").trim(),
      };
    }).filter((row) => row.date && row.dong);

    setDefaultDates(rawRows);
    refreshView();
    mapStatus.textContent = "";
  } catch (error) {
    mapStatus.textContent = "CSV 공개 여부를 확인해주세요.";
    console.error(error);
  }
}

[dateStart, dateEnd, searchText].forEach((el) => {
  el.addEventListener("input", refreshView);
});
pathChecks.forEach((el) => {
  el.addEventListener("change", refreshView);
});
resetBtn.addEventListener("click", () => {
  searchText.value = "";
  pathChecks.forEach((el) => (el.checked = true));
  setDefaultDates(rawRows);
  refreshView();
});

initMap();
loadData();
