const API_URL = "https://script.google.com/macros/s/AKfycbxcZ7SQliMDn1YN7weZsyqHg8aYWIcgBDm0enWYWU59LrPlFLmGHNueyhqXIT_G6xUg/exec";

const mapStatus = document.getElementById("map-status");
const listCount = document.getElementById("list-count");
const tableBody = document.getElementById("table-body");
const statTotal = document.getElementById("stat-total");
const statToday = document.getElementById("stat-today");
const dateStart = document.getElementById("date-start");
const dateEnd = document.getElementById("date-end");
const searchText = document.getElementById("search-text");
const resetBtn = document.getElementById("reset-btn");
const pathChecks = Array.from(document.querySelectorAll(".chip input"));

let rawRows = [];
let map;
let markers = []; // 동 단위 버블
let detailMarkers = []; // 상세 위치 핀

const geocodeCache = JSON.parse(localStorage.getItem("dong-geocode") || "{}");

/**
 * [핵심] 주소를 분석하여 동(광주) 또는 시/군(전남) 추출
 */
function extractDong(address) {
  if (!address) return "기타";

  // 1. 전남 시/군 체크
  const jeonnamCities = [
    "목포시", "목포", "여수시", "여수", "순천시", "순천", "나주시", "나주", "광양시", "광양",
    "담양군", "담양", "곡성군", "곡성", "구례군", "구례", "고흥군", "고흥", 
    "보성군", "보성", "화순군", "화순", "장흥군", "장흥", "강진군", "강진", 
    "해남군", "해남", "영암군", "영암", "무안군", "무안", "함평군", "함평", 
    "영광군", "영광", "장성군", "장성", "완도군", "완도", "진도군", "진도", "신안군", "신안"
  ];
  for (const city of jeonnamCities) {
    if (address.includes(city)) return city.replace("시", "").replace("군", "");
  }

  // 2. 주소에 "동"이 직접 포함된 경우 우선 추출
  const match = address.match(/([가-힣0-9]+동)/);
  if (match) return match[1];

  // 3. 도로명만 있을 경우 해당 "동"으로 매핑
  const roadToDong = {
    // 동구
    "금남로": "서석동", "충장로": "충장동", "계림로": "계림동", "대인로": "대인동", "지산로": "지산동", "학동로": "학동", "산수로": "산수동",
    // 서구
    "상무대로": "치평동", "상무중앙로": "치평동", "상무평화로": "치평동", "농성로": "농성동", "백서로": "양림동", "화정로": "화정동", "풍암로": "풍암동", "유덕로": "유덕동", "금화로": "화정동", "치평로": "치평동", "서창로": "서창동", "마륵로": "마륵동",
    // 남구
    "봉선로": "봉선동", "백운로": "백운동", "양림로": "양림동", "월산로": "월산동", "진월로": "진월동", "방림로": "방림동", "서문대로": "진월동", "구동로": "구동",
    // 북구
    "무등로": "중흥동", "문흥로": "문흥동", "용봉로": "용봉동", "첨단과기로": "오룡동", "오치로": "오치동", "신안로": "신안동", "우산로": "우산동", "두암로": "두암동", "임동로": "임동", "매곡로": "매곡동", "운암로": "운암동", "충효로": "충효동",
    // 광산구
    "하남대로": "하남동", "수완로": "수완동", "장신로": "수완동", "첨단중앙로": "첨단동", "평동로": "평동", "송정로": "송정동", "신창로": "신창동", "월계로": "월계동", "산정로": "산정동"
  };
  for (const road in roadToDong) {
    if (address.includes(road)) return roadToDong[road];
  }

  // 4. 예외 케이스
  if (address.includes("대천로")) return "문흥동";

  return "기타";
}

async function geocode(query) {
  const isJeonnam = ["목포","여수","순천","나주","광양","담양","곡성","구례","고흥","보성","화순","장흥","강진","해남","영암","무안","함평","영광","장성","완도","진도","신안"].includes(query);
  const fullQuery = isJeonnam ? `전라남도 ${query}` : (query.includes("광주") ? query : `광주광역시 ${query}`);
  
  if (geocodeCache[fullQuery]) return geocodeCache[fullQuery];

  return new Promise((resolve) => {
    naver.maps.Service.geocode({ query: fullQuery }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK || !response.v2.addresses.length) {
        resolve(null);
        return;
      }
      const item = response.v2.addresses[0];
      const coords = { lat: parseFloat(item.y), lng: parseFloat(item.x) };
      geocodeCache[fullQuery] = coords;
      localStorage.setItem("dong-geocode", JSON.stringify(geocodeCache));
      resolve(coords);
    });
  });
}

async function showDetailMarkers(items, centerPos) {
  detailMarkers.forEach(m => m.setMap(null));
  detailMarkers = [];
  markers.forEach(m => m.setVisible(false));

  for (const item of items) {
    const coords = await geocode(item.address);
    if (coords) {
      const m = new naver.maps.Marker({
        position: new naver.maps.LatLng(coords.lat, coords.lng),
        map: map,
        animation: naver.maps.Animation.DROP,
        title: item.address
      });
      detailMarkers.push(m);
    }
  }
  map.setCenter(centerPos);
  map.setZoom(16);
}

function resetToDongView() {
  detailMarkers.forEach(m => m.setMap(null));
  detailMarkers = [];
  markers.forEach(m => m.setVisible(true));
  map.setZoom(12);
}

async function updateMap(rows) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  
  const grouped = new Map();
  rows.forEach(row => {
    const entry = grouped.get(row.dong) || { count: 0, items: [] };
    entry.count += 1;
    entry.items.push(row);
    grouped.set(row.dong, entry);
  });

  for (const [dongName, data] of grouped.entries()) {
    const coords = await geocode(dongName);
    if (!coords) continue;

    const pos = new naver.maps.LatLng(coords.lat, coords.lng);
    const size = Math.min(45 + (data.count * 6), 90);

    const marker = new naver.maps.Marker({
      position: pos,
      map: map,
      icon: {
        content: `
          <div style="width:${size}px; height:${size}px; background:#ff6a3d; color:white; border-radius:50%; 
               display:flex; flex-direction:column; align-items:center; justify-content:center; 
               border:3px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor:pointer;">
            <div style="font-size:10px; opacity:0.8;">${dongName}</div>
            <div style="font-size:16px; font-weight:800;">${data.count}</div>
          </div>`,
        anchor: new naver.maps.Point(size/2, size/2)
      }
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      showDetailMarkers(data.items, pos);
    });

    markers.push(marker);
  }
}

function refreshView() {
  const activePaths = pathChecks.filter(el => el.checked).map(el => el.value);
  const keyword = searchText.value.trim().toLowerCase();
  const start = dateStart.value;
  const end = dateEnd.value;

  const filtered = rawRows.filter(row => {
    if (!activePaths.includes(row.offlinePath)) return false;
    if (keyword && !`${row.dong} ${row.address} ${row.school}`.toLowerCase().includes(keyword)) return false;
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    return true;
  });

  statTotal.textContent = filtered.length;
  statToday.textContent = filtered.filter(r => r.date === new Date().toISOString().slice(0, 10)).length;
  listCount.textContent = `${filtered.length} 건`;

  tableBody.innerHTML = filtered.map(row => `
    <tr>
      <td>${row.date}</td>
      <td>${row.dong}</td>
      <td>${row.offlinePath}</td>
      <td>${row.region}</td>
    </tr>`).join("");

  updateMap(filtered);
}

async function loadData() {
  mapStatus.textContent = "불러오는 중...";
  try {
    const response = await fetch(API_URL);
    const rows = await response.json();
    rawRows = rows.map(row => ({
      date: row.date ? new Date(row.date).toISOString().slice(0, 10) : "",
      offlinePath: (row.offline || "").includes("포스터") ? "포스터" : ((row.offline || "").includes("정류장") ? "정류장" : "기타"),
      dong: extractDong(row.address),
      address: (row.address || "").trim(),
      school: row.school || "",
      region: row.region || ""
    })).filter(r => r.date);
    
    refreshView();
    mapStatus.textContent = "";
  } catch (e) { 
    console.error(e);
    mapStatus.textContent = "연결 실패"; 
  }
}

function initMap() {
  map = new naver.maps.Map("map", {
    center: new naver.maps.LatLng(35.1595, 126.8526),
    zoom: 12
  });
  naver.maps.Event.addListener(map, 'click', resetToDongView);
}

[dateStart, dateEnd, searchText].forEach(el => el.addEventListener("input", refreshView));
pathChecks.forEach(el => el.addEventListener("change", refreshView));
resetBtn.addEventListener("click", () => {
  searchText.value = "";
  pathChecks.forEach(c => c.checked = true);
  refreshView();
});

initMap();
loadData();