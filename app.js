const API_URL = "https://script.google.com/macros/s/AKfycbxcZ7SQliMDn1YN7weZsyqHg8aYWIcgBDm0enWYWU59LrPlFLmGHNueyhqXIT_G6xUg/exec";

// DOM 요소 연동
const mapStatus = document.getElementById("map-status");
const listCount = document.getElementById("list-count");
const tableBody = document.getElementById("table-body");
const statTotal = document.getElementById("stat-total");
const statToday = document.getElementById("stat-today");
const dateStart = document.getElementById("date-start");
const dateEnd = document.getElementById("date-end");
const searchText = document.getElementById("search-text");
const resetBtn = document.getElementById("reset-btn");
const deselectAllBtn = document.getElementById("deselect-all-btn");

// 지점별 실시간 카운트 UI
const uiDonggu = document.getElementById("count-donggu");
const uiNamgu = document.getElementById("count-namgu");
const uiCheomdan = document.getElementById("count-cheomdan");

// 필터 참조 함수
const getPathChecks = () => Array.from(document.querySelectorAll(".chip input:not([data-type='branch'])"));
const getBranchChecks = () => Array.from(document.querySelectorAll(".chip input[data-type='branch']"));

let rawRows = [];
let map;
let markers = [];
let selectedMarker = null;

const geocodeCache = JSON.parse(localStorage.getItem("dong-geocode") || "{}");

/**
 * 1. 주소 분석 및 동 추출 (강화된 매핑 데이터)
 */
function extractDong(address) {
  if (!address) return "기타";
  const cleanAddress = address.replace(/\s+/g, "");

  const roadToDong = {
    "엠코로": "오룡동", "월곡산정로": "월곡동", "천지인로": "본촌동", "대천로": "문흥동",
    "임방울대로": "수완동", "장신로": "수완동", "수완로": "수완동", "풍영로": "수완동",
    "신창로": "신창동", "첨단중앙로": "첨단동", "월계로": "월계동", "사암로": "월곡동",
    "쌍암": "쌍암동", "선운": "선암동", "효천": "임암동", "본촌": "본촌동"
  };

  for (const road in roadToDong) {
    if (cleanAddress.includes(road)) return roadToDong[road];
  }

  const dongMatch = address.match(/([가-힣0-9]+동)/);
  return dongMatch ? dongMatch[1] : "기타";
}

/**
 * 2. 수강 신청 텍스트에서 [지점명] 추출
 */
function extractBranch(row) {
  const fullText = Object.values(row).join(" ");
  const match = fullText.match(/\[(동구점|남구점|첨단점)\]/);
  return match ? match[1] : "미지정";
}

/**
 * 3. 뷰 새로고침 및 통계 계산
 */
function refreshView() {
  const activePaths = getPathChecks().filter(el => el.checked).map(el => el.value);
  const activeBranches = getBranchChecks().filter(el => el.checked).map(el => el.value);
  const keyword = searchText.value.trim().toLowerCase();
  const start = dateStart.value;
  const end = dateEnd.value;

  const filtered = rawRows.filter(row => {
    if (activeBranches.length > 0 && !activeBranches.includes(row.branch)) return false;
    if (!activePaths.includes(row.offlinePath)) return false;
    if (keyword && !`${row.dong} ${row.address} ${row.branch}`.toLowerCase().includes(keyword)) return false;
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    return true;
  });

  statTotal.textContent = filtered.length;

  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const todayStr = new Date(now.getTime() - offset + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  statToday.textContent = rawRows.filter(r => r.date === todayStr).length;

  const branchCounts = { "동구점": 0, "남구점": 0, "첨단점": 0 };
  filtered.forEach(r => {
    if (branchCounts[r.branch] !== undefined) branchCounts[r.branch]++;
  });

  if (uiDonggu) uiDonggu.textContent = branchCounts["동구점"];
  if (uiNamgu) uiNamgu.textContent = branchCounts["남구점"];
  if (uiCheomdan) uiCheomdan.textContent = branchCounts["첨단점"];

  listCount.textContent = `${filtered.length} 건`;

  tableBody.innerHTML = filtered.map(row => `
    <tr>
      <td style="font-weight:600; color:#1e293b;">${row.date}</td>
      <td style="font-weight:700; color:#475569;">${row.branch}</td>
      <td><span style="background:#f1f5f9; padding:4px 10px; border-radius:8px; font-size:13px; font-weight:700;">${row.dong}</span></td>
      <td style="color:#64748b; font-size:12px;">${row.offlinePath}</td>
    </tr>`).join("");

  updateMap(filtered);
}

/**
 * 4. 데이터 로드 및 전처리
 */
async function loadData() {
  mapStatus.innerHTML = `📡 데이터를 동기화 중...`;
  try {
    const response = await fetch(API_URL);
    const rows = await response.json();
    rawRows = rows.map(row => ({
      date: row.date ? new Date(row.date).toISOString().slice(0, 10) : "",
      branch: extractBranch(row),
      offlinePath: (function(val) {
        const path = val || "기타";
        if (path.includes("버스정류장")) return "버스정류장";
        if (path.includes("버스의자시트")) return "버스의자시트";
        if (path.includes("택배")) return "택배 배송차량";
        if (path.includes("현수막")) return "현수막";
        if (path.includes("포스터")) return "포스터(벽보)";
        if (path.includes("전단지")) return "전단지";
        if (path.includes("국민취업")) return "국민취업지원제도";
        if (path.includes("교내광고")) return "교내광고";
        if (path.includes("설명회")) return "설명회";
        if (path.includes("아파트 거울")) return "아파트 거울";
        if (path.includes("추천")) return "지인 추천"; 
        return "기타";
      })(row.offline),
      dong: extractDong(row.address),
      address: (row.address || "").trim()
    })).filter(r => r.date);
    
    refreshView();
    mapStatus.textContent = "✅ 최신 데이터 동기화 완료";
    setTimeout(() => { mapStatus.textContent = ""; }, 3000);
  } catch (e) { 
    mapStatus.innerHTML = `<span style="color:#ff6a3d;">❌ 서버 연결 실패</span>`; 
  }
}

/**
 * 5. 지도 기능
 */
function initMap() {
  const mapContainer = document.getElementById("map");
  map = new naver.maps.Map(mapContainer, {
    center: new naver.maps.LatLng(35.1595, 126.8526),
    zoom: 12,
    zoomControl: true,
    logoControl: false
  });
  
  // 지도 빈 곳 클릭 시 초기 상태로 복귀
  naver.maps.Event.addListener(map, 'click', () => {
    if (selectedMarker) {
      selectedMarker = null;
      map.setZoom(12);
      map.setCenter(new naver.maps.LatLng(35.1595, 126.8526));
      mapStatus.textContent = "";
    }
  });
}

async function geocode(query) {
  const fullQuery = query.includes("광주") ? query : `광주광역시 ${query}`;
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

async function updateMap(rows) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  selectedMarker = null;
  
  const grouped = new Map();
  rows.forEach(row => {
    const entry = grouped.get(row.dong) || { count: 0 };
    entry.count += 1;
    grouped.set(row.dong, entry);
  });

  for (const [dongName, data] of grouped.entries()) {
    const coords = await geocode(dongName);
    if (!coords) continue;
    
    const size = Math.min(48 + (data.count * 5), 95);
    const markerContent = document.createElement('div');
    markerContent.className = 'dong-marker';
    markerContent.style.cssText = `width:${size}px; height:${size}px; background:white; color:#ff6a3d; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:3px solid #ff6a3d; box-shadow: 0 4px 10px rgba(0,0,0,0.2); cursor:pointer; transition: all 0.3s ease;`;
    markerContent.innerHTML = `
      <div style="font-size:10px; font-weight:700; color:#333;">${dongName}</div>
      <div style="font-size:18px; font-weight:900;">${data.count}</div>
    `;
    
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(coords.lat, coords.lng),
      map: map,
      icon: {
        content: markerContent,
        anchor: new naver.maps.Point(size/2, size/2)
      }
    });
    
    // DOM 요소에 직접 클릭 이벤트 추가 (이벤트 버블링 방지)
    markerContent.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMarker = marker;
      
      // 해당 동으로 이동 및 줌인
      map.setCenter(new naver.maps.LatLng(coords.lat, coords.lng));
      map.setZoom(14);
      
      // 상태 메시지 표시 (계속 보이도록 타이머 제거)
      mapStatus.innerHTML = `📍 <strong>${dongName}</strong> (신청 ${data.count}건)`;
    });
    
    // 호버 효과
    markerContent.addEventListener('mouseenter', () => {
      markerContent.style.cssText = `width:${size}px; height:${size}px; background:#ff6a3d; color:white; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:3px solid #ff6a3d; box-shadow: 0 6px 20px rgba(255,106,61,0.4); cursor:pointer; transform: scale(1.1);`;
      markerContent.innerHTML = `
        <div style="font-size:10px; font-weight:700;">${dongName}</div>
        <div style="font-size:18px; font-weight:900;">${data.count}</div>
      `;
    });
    
    markerContent.addEventListener('mouseleave', () => {
      markerContent.style.cssText = `width:${size}px; height:${size}px; background:white; color:#ff6a3d; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; border:3px solid #ff6a3d; box-shadow: 0 4px 10px rgba(0,0,0,0.2); cursor:pointer; transition: all 0.3s ease;`;
      markerContent.innerHTML = `
        <div style="font-size:10px; font-weight:700; color:#333;">${dongName}</div>
        <div style="font-size:18px; font-weight:900;">${data.count}</div>
      `;
    });
    
    markers.push(marker);
  }
}

/**
 * 6. 초기화 및 이벤트 리스너
 */
function init() {
  initMap();
  loadData();
  
  flatpickr("#date-start", { locale: "ko", dateFormat: "Y-m-d", onChange: refreshView });
  flatpickr("#date-end", { locale: "ko", dateFormat: "Y-m-d", onChange: refreshView });

  searchText.addEventListener("input", refreshView);
  
  // 체크박스 변경 감지
  document.addEventListener('change', (e) => {
    if (e.target.closest('.chip input')) refreshView();
  });

  // [기능 1] 필터 초기화 (모두 체크 + 입력창 비움)
  resetBtn.addEventListener("click", () => {
    searchText.value = "";
    if(dateStart._flatpickr) dateStart._flatpickr.clear();
    if(dateEnd._flatpickr) dateEnd._flatpickr.clear();
    getPathChecks().concat(getBranchChecks()).forEach(c => c.checked = true);
    refreshView();
  });

  // [기능 2] 전체 선택 해제 (모든 체크박스 끔)
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      getPathChecks().concat(getBranchChecks()).forEach(c => {
        c.checked = false;
      });
      refreshView();
    });
  }
}

init();