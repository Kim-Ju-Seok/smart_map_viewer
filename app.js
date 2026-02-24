// ★주의: 새로 배포한 웹 앱 URL이 맞는지 확인하세요!
const API_URL = "https://script.google.com/macros/s/AKfycbwXFETj3boiOMxtNStSazbaHTI08pG2-yoEJxNoJY0BPS3EqEFjGg8LXx2mXjd9_pMG/exec";

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
let busMarkers = []; // 버스 정류장 마커 관리용 배열
let selectedMarker = null;

const geocodeCache = JSON.parse(localStorage.getItem("dong-geocode") || "{}");

let sortedRoadsCache = null; // 검색 속도 최적화를 위한 캐시 변수

/**
 * 1. 주소 분석 및 동 추출 (띄어쓰기 오류 방지 적용)
 */
function extractDong(address) {
  if (!address) return "기타";
  
  // 1단계: 띄어쓰기를 모두 없애서 "서구풍암1로53" 처럼 완전히 붙여버립니다.
  const cleanAddress = address.replace(/\s+/g, "");

  // 2단계: 괄호 안에 명시된 법정동/행정동이 있으면 최우선으로 찾음 (예: 쌍암동)
  const dongInParentheses = address.match(/\(([가-힣0-9]+동)\)/);
  if (dongInParentheses) return dongInParentheses[1];

  // 3단계: DB에 있는 도로명이 붙여쓴 주소에 포함되어 있는지 검색
  if (typeof roadToDongDB !== 'undefined') {
    if (!sortedRoadsCache) {
      sortedRoadsCache = Object.keys(roadToDongDB).sort((a, b) => b.length - a.length);
    }
    
    for (let road of sortedRoadsCache) {
      if (cleanAddress.includes(road)) {
        return roadToDongDB[road];
      }
    }
  }

  // 4단계: 도로명이 아예 없고 '동' 이름만 적힌 경우 (★ 수정된 부분)
  // 사용자가 "광주남구송하동" 처럼 다 붙여서 쓴 경우를 대비해, 
  // '광주광역시'나 '구' 이름을 먼저 삭제한 뒤 순수 '동'만 추출합니다.
  const removeCityGu = address.replace(/광주(광역시)?/g, "").replace(/(동구|서구|남구|북구|광산구)/g, "");
  const dongMatch = removeCityGu.match(/([가-힣0-9]+동)/);
  
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

  // ★ 날짜 오류 100% 해결: 브라우저 환경 무시하고 완벽한 한국(KST) 날짜 추출
  const now = new Date();
  const todayStr = new Date(now.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  
  // 오늘 날짜와 정확히 일치하는 데이터만 카운트
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
    const data = await response.json();
    
    // 1. 신청자 데이터 매핑
    if (data.applicants) {
      rawRows = data.applicants.map(row => ({
        // ★ 날짜 오류 방지: 서버에서 준 "YYYY-MM-DD" 문자열을 그대로 사용
        date: row.date ? String(row.date).slice(0, 10) : "",
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
    }

    // 2. 버스 정류장 데이터 그리기
    if (data.busStops && data.busStops.length > 0) {
      drawBusStops(data.busStops);
    }

    mapStatus.textContent = "✅ 최신 데이터 동기화 완료";
    setTimeout(() => { mapStatus.textContent = ""; }, 3000);
  } catch (e) { 
    console.error(e);
    mapStatus.innerHTML = `<span style="color:#ff6a3d;">❌ 서버 연결 실패</span>`; 
  }
}

/**
 * 5. 버스 정류장 마커 그리기 함수
 */
function drawBusStops(busStops) {
  // 기존 버스 마커 초기화
  busMarkers.forEach(m => m.setMap(null));
  busMarkers = [];

  busStops.forEach(stop => {
    const lat = parseFloat(stop.lat);
    const lng = parseFloat(stop.lng);
    if (isNaN(lat) || isNaN(lng)) return;

    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(lat, lng),
      map: map,
      icon: {
        content: `
          <div class="bus-marker">
            <i class="fa-solid fa-bus"></i>
          </div>`,
        anchor: new naver.maps.Point(14, 14)
      }
    });

    const infoWindow = new naver.maps.InfoWindow({
      content: `
        <div class="custom-infowindow">
          <b>[광고 위치]</b>
          <div style="font-size: 14px; font-weight: 700; margin-bottom: 2px;">${stop.name} 정류장</div>
          <span>정류장 번호: ${stop.id}</span>
        </div>`,
      borderWidth: 0,
      backgroundColor: "transparent",
      disableAnchor: true
    });

    naver.maps.Event.addListener(marker, "click", () => {
      if (infoWindow.getMap()) {
        infoWindow.close();
      } else {
        infoWindow.open(map, marker);
      }
    });

    busMarkers.push(marker);
  });
}

/**
 * 6. 지도 기능
 */
function initMap() {
  const mapContainer = document.getElementById("map");
  map = new naver.maps.Map(mapContainer, {
    center: new naver.maps.LatLng(35.1595, 126.8526),
    zoom: 12,
    zoomControl: true,
    logoControl: false
  });
  
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
    
    markerContent.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedMarker = marker;
      map.setCenter(new naver.maps.LatLng(coords.lat, coords.lng));
      map.setZoom(14);
      mapStatus.innerHTML = `📍 <strong>${dongName}</strong> (신청 ${data.count}건)`;
    });
    
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
 * 7. 초기화 및 이벤트 리스너
 */
function init() {
  initMap();
  loadData();
  
  flatpickr("#date-start", { locale: "ko", dateFormat: "Y-m-d", onChange: refreshView });
  flatpickr("#date-end", { locale: "ko", dateFormat: "Y-m-d", onChange: refreshView });

  // 💡 검색창 최적화 (디바운싱 적용: 타이핑 시 렉 제거)
  let searchTimeout;
  searchText.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(refreshView, 200); 
  });
  
  document.addEventListener('change', (e) => {
    if (e.target.closest('.chip input')) refreshView();
  });

  resetBtn.addEventListener("click", () => {
    searchText.value = "";
    if(dateStart._flatpickr) dateStart._flatpickr.clear();
    if(dateEnd._flatpickr) dateEnd._flatpickr.clear();
    getPathChecks().concat(getBranchChecks()).forEach(c => c.checked = true);
    refreshView();
  });

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

/**
 * =========================================
 * 🎮 숨겨진 미니게임 1 로직 (이스터에그: 두더지 잡기)
 * =========================================
 */
let easterEggCount = 0;
const mainChar = document.querySelector('.char-main');

if(mainChar) {
  mainChar.addEventListener('click', () => {
    easterEggCount++;
    if (easterEggCount === 3) alert("👀 어랏...? 캐릭터를 두 번만 더 눌러보세요!");
    if (easterEggCount === 5) {
      startMiniGame();
      easterEggCount = 0; 
    }
  });
}

function startMiniGame() {
  const scoreBoard = document.createElement('div');
  scoreBoard.className = 'game-score-board';
  document.body.appendChild(scoreBoard);
  scoreBoard.style.display = 'block';
  
  let score = 0;
  let timeLeft = 15; 
  scoreBoard.innerHTML = `⏱ ${timeLeft}초 | 📝 수집: ${score}건`;

  const gameInterval = setInterval(() => {
    const target = document.createElement('img');
    target.src = Math.random() > 0.5 ? '스밈임티2.png' : '스밈임티3.png';
    target.className = 'mini-game-target';
    
    const randomX = Math.random() * (window.innerWidth - 100);
    const randomY = Math.random() * (window.innerHeight - 100);
    target.style.left = randomX + 'px';
    target.style.top = randomY + 'px';
    
    target.addEventListener('click', function() {
      score++;
      scoreBoard.innerHTML = `⏱ ${timeLeft}초 | 📝 수집: ${score}건`;
      this.style.transform = "scale(0)";
      setTimeout(() => this.remove(), 100);
    });

    document.body.appendChild(target);

    setTimeout(() => { 
      if(target.parentNode) target.remove(); 
    }, 1000);

  }, 600);

  const timerInterval = setInterval(() => {
    timeLeft--;
    scoreBoard.innerHTML = `⏱ ${timeLeft}초 | 📝 수집: ${score}건`;
    
    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      clearInterval(timerInterval);
      
      document.querySelectorAll('.mini-game-target').forEach(el => el.remove());
      scoreBoard.remove();
      
      setTimeout(() => {
        if(score >= 15) {
          alert(`🎉 대박! 무려 ${score}건의 신청서를 수집했습니다!\n광주의 오프라인 마케팅 마스터로 임명합니다! 🏆`);
        } else {
          alert(`⏰ 게임 종료!\n총 ${score}건의 신청서를 수집했습니다.\n조금 더 분발해 볼까요? 💪`);
        }
      }, 100);
    }
  }, 1000);
}

/**
 * =========================================
 * 🎮 두 번째 이스터에그 (신청서 받기 게임 - GPU 가속 버전)
 * =========================================
 */
let catchEggCount = 0;
const subChar = document.querySelector('.char-sub'); 

if (subChar) {
  subChar.addEventListener('click', () => {
    catchEggCount++;
    if (catchEggCount === 3) alert("💡 분석을 멈추고 게임을 해볼까요? 2번 더 클릭!");
    if (catchEggCount === 5) {
      initCatchGame();
      catchEggCount = 0;
    }
  });
}

function initCatchGame() {
  const overlay = document.createElement('div');
  overlay.id = 'catch-game-overlay';
  overlay.innerHTML = `
    <div id="catch-score-board">SCORE: <span id="catch-score">0</span></div>
    <img src="스밈임티2.png" id="catch-player" alt="player">
    <div id="catch-game-over">
      <h2>💥 폭탄을 맞았습니다!</h2>
      <p>최종 점수: <strong id="catch-final-score">0</strong>점</p>
      <button class="catch-btn" id="catch-restart">다시 하기</button>
      <button class="catch-btn catch-close" id="catch-exit">닫기</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'block';

  const player = document.getElementById('catch-player');
  const scoreDisplay = document.getElementById('catch-score');
  const gameOverScreen = document.getElementById('catch-game-over');
  
  let score = 0;
  let gameActive = true;
  let items = [];
  let fallSpeed = 5;
  let spawnRate = 800;
  let playerX = window.innerWidth / 2;
  
  // 플레이어 초기 위치 설정 (GPU 최적화)
  player.style.transform = `translateX(calc(${playerX}px - 50%))`;

  overlay.addEventListener('mousemove', (e) => {
    if (!gameActive) return;
    playerX = e.clientX;
    player.style.transform = `translateX(calc(${playerX}px - 50%))`;
  });

  const spawnInterval = setInterval(() => {
    if (!gameActive) return;
    
    const item = document.createElement('div');
    item.className = 'falling-item';
    const isBomb = Math.random() < 0.2;
    item.innerHTML = isBomb ? '💣' : '📄';
    item.dataset.type = isBomb ? 'bomb' : 'paper';
    
    const startX = Math.random() * (window.innerWidth - 60) + 30;
    item.style.transform = `translate(${startX}px, -50px)`;
    
    overlay.appendChild(item);
    items.push({ el: item, x: startX, y: -50, type: item.dataset.type });
    
    fallSpeed += 0.05;
  }, spawnRate);

  function gameLoop() {
    if (!gameActive) return;

    const playerRect = player.getBoundingClientRect();
    const catchAreaY = playerRect.top + 20;

    for (let i = items.length - 1; i >= 0; i--) {
      let item = items[i];
      item.y += fallSpeed;
      item.el.style.transform = `translate(${item.x}px, ${item.y}px)`;

      // 충돌 판정
      if (item.y > catchAreaY && item.y < playerRect.bottom) {
        if (Math.abs(item.x - playerX) < 60) {
          if (item.type === 'bomb') {
            endGame();
            return;
          } else {
            score += 10;
            scoreDisplay.textContent = score;
            
            player.style.transform = `translateX(calc(${playerX}px - 50%)) scale(1.2)`;
            setTimeout(() => {
              if (gameActive) player.style.transform = `translateX(calc(${playerX}px - 50%)) scale(1)`;
            }, 100);
            
            item.el.remove();
            items.splice(i, 1);
            continue;
          }
        }
      }

      if (item.y > window.innerHeight) {
        item.el.remove();
        items.splice(i, 1);
      }
    }
    requestAnimationFrame(gameLoop);
  }

  function endGame() {
    gameActive = false;
    clearInterval(spawnInterval);
    document.getElementById('catch-final-score').textContent = score;
    gameOverScreen.style.display = 'block';
    overlay.style.cursor = 'default';
  }

  document.getElementById('catch-restart').addEventListener('click', () => {
    overlay.remove();
    initCatchGame();
  });

  document.getElementById('catch-exit').addEventListener('click', () => {
    overlay.remove();
  });

  requestAnimationFrame(gameLoop);
}

/**
 * =========================================
 * 🎮 세 번째 이스터에그: 스밈이의 장애물 넘기 (Dino Run)
 * =========================================
 */
let jumpEggCount = 0;
const btnChar = document.querySelector('.char-btn'); // 필터쪽 스밈임티3

if (btnChar) {
  btnChar.addEventListener('click', () => {
    jumpEggCount++;
    if (jumpEggCount === 3) alert("🚀 세 번째 비밀! 2번만 더 눌러보세요!");
    if (jumpEggCount === 5) {
      initJumpGame();
      jumpEggCount = 0;
    }
  });
}

function initJumpGame() {
  // 오버레이 및 UI 생성
  const overlay = document.createElement('div');
  overlay.id = 'jump-game-overlay';
  overlay.innerHTML = `
    <div id="jump-score-board">SCORE: <span id="jump-score">0</span></div>
    <div id="jump-ground"></div>
    <img src="스밈임티3.png" id="jump-player" alt="player">
    <div id="jump-game-over">
      <h2>💥 충돌했습니다!</h2>
      <p>최종 점수: <span id="jump-final-score">0</span>점</p>
      <button class="catch-btn" id="jump-restart">다시 달리기</button>
      <button class="catch-btn catch-close" id="jump-exit">닫기</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'block';

  // 게임 요소
  const player = document.getElementById('jump-player');
  const scoreDisplay = document.getElementById('jump-score');
  const gameOverScreen = document.getElementById('jump-game-over');
  
  let gameActive = true;
  let score = 0;
  
  // 물리 엔진 변수
  let playerY = 0; // 0이 바닥
  let velocityY = 0;
  const gravity = 0.8;
  const jumpPower = 16;
  let isJumping = false;

  // 장애물 변수
  let obstacles = [];
  let obSpeed = 8;
  let frameCount = 0;

  // 점프 동작 (클릭 또는 스페이스바)
  function doJump() {
    if (!isJumping && gameActive) {
      isJumping = true;
      velocityY = jumpPower;
      // 점프할 때 살짝 찌그러지는 애니메이션 효과
      player.style.transform = `translateY(${-playerY}px) scaleY(1.2)`;
      setTimeout(() => {
        if(gameActive) player.style.transform = `translateY(${-playerY}px) scaleY(1)`;
      }, 200);
    }
  }

  overlay.addEventListener('mousedown', doJump);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && overlay.style.display === 'block') doJump();
  });

  // 메인 게임 루프
  function gameLoop() {
    if (!gameActive) return;
    frameCount++;

    // 1. 점수 증가 & 난이도 상승
    if (frameCount % 5 === 0) {
      score++;
      scoreDisplay.textContent = score;
      if (score % 100 === 0) obSpeed += 1; // 100점마다 속도 증가
    }

    // 2. 플레이어 물리(중력) 계산
    if (isJumping) {
      playerY += velocityY;
      velocityY -= gravity; // 중력 적용 (점점 떨어짐)
      
      // 바닥에 닿았을 때
      if (playerY <= 0) {
        playerY = 0;
        isJumping = false;
        velocityY = 0;
      }
    }
    // GPU 가속을 사용한 플레이어 이동
    player.style.transform = `translateY(${-playerY}px)`;

    // 3. 장애물 생성 (랜덤 간격)
    if (frameCount % 80 === 0 || (frameCount > 100 && Math.random() < 0.01)) {
      if (obstacles.length === 0 || obstacles[obstacles.length-1].x < window.innerWidth - 300) {
        const ob = document.createElement('div');
        ob.className = 'jump-obstacle';
        // 서류 더미 또는 버그 아이콘
        ob.innerHTML = Math.random() > 0.5 ? '🗂️' : '🐛';
        overlay.appendChild(ob);
        
        obstacles.push({
          el: ob,
          x: window.innerWidth,
          width: 50,
          height: 50
        });
      }
    }

    // 4. 장애물 이동 및 충돌 판정
    for (let i = obstacles.length - 1; i >= 0; i--) {
      let ob = obstacles[i];
      ob.x -= obSpeed;
      ob.el.style.transform = `translateX(${ob.x}px)`;

      // 화면 밖으로 나가면 제거
      if (ob.x < -100) {
        ob.el.remove();
        obstacles.splice(i, 1);
        continue;
      }

      // 충돌 판정 (Hitbox 설정)
      const playerX = window.innerWidth * 0.15; // left: 15%
      const playerWidth = 60; // 실제 충돌 범위는 약간 작게 (관대하게)
      const playerHeight = 60;

      // X축 겹침 확인
      if (ob.x < playerX + playerWidth && ob.x + ob.width > playerX) {
        // Y축 겹침 확인 (playerY가 ob.height 보다 낮으면 충돌)
        if (playerY < ob.height - 10) {
          endGame();
          return;
        }
      }
    }

    requestAnimationFrame(gameLoop);
  }

  function endGame() {
    gameActive = false;
    document.getElementById('jump-final-score').textContent = score;
    gameOverScreen.style.display = 'block';
  }

  // 버튼 이벤트
  document.getElementById('jump-restart').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
    initJumpGame();
  });

  document.getElementById('jump-exit').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
  });

  requestAnimationFrame(gameLoop);
}

/**
 * =========================================
 * 🎮 네 번째 이스터에그: 스페이스 스밈이 (버그 퇴치 슈팅!)
 * =========================================
 */
let shootEggCount = 0;
const titleTrigger = document.querySelector('h1'); // 메인 타이틀을 트리거로 사용

if (titleTrigger) {
  titleTrigger.style.cursor = "pointer"; // 마우스 올리면 클릭 가능한 것처럼 표시
  titleTrigger.addEventListener('click', () => {
    shootEggCount++;
    if (shootEggCount === 3) alert("🚀 시스템 방어 모드 가동 준비 중... (2번 더 클릭)");
    if (shootEggCount === 5) {
      initShootGame();
      shootEggCount = 0;
    }
  });
}

function initShootGame() {
  const overlay = document.createElement('div');
  overlay.id = 'shoot-game-overlay';
  overlay.innerHTML = `
    <div id="shoot-score-board">DESTROYED: <span id="shoot-score">0</span></div>
    <img src="스밈임티1.png" id="shoot-player" alt="player">
    <div id="shoot-game-over">
      <h2>SYSTEM BREACHED!</h2>
      <p>방어한 악성 데이터: <strong id="shoot-final-score" style="color:#38bdf8; font-size:30px;">0</strong>건</p>
      <button class="shoot-btn" id="shoot-restart">REBOOT (다시하기)</button>
      <button class="shoot-btn shoot-close" id="shoot-exit">EXIT (닫기)</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.style.display = 'block';

  // 배경 별 만들기
  for(let i=0; i<30; i++) {
    const star = document.createElement('div');
    star.className = 'starfield';
    star.style.left = Math.random() * 100 + 'vw';
    star.style.top = Math.random() * 100 + 'vh';
    star.style.animationDuration = (Math.random() * 3 + 2) + 's';
    overlay.appendChild(star);
  }

  const player = document.getElementById('shoot-player');
  const scoreDisplay = document.getElementById('shoot-score');
  const gameOverScreen = document.getElementById('shoot-game-over');
  
  let gameActive = true;
  let score = 0;
  let playerX = window.innerWidth / 2;
  
  // 오브젝트 배열들
  let bullets = [];
  let enemies = [];
  let particles = [];
  
  // 플레이어 이동
  overlay.addEventListener('mousemove', (e) => {
    if (!gameActive) return;
    playerX = e.clientX;
    player.style.transform = `translateX(calc(${playerX}px - 50%))`;
  });

  // 클릭 시 총알 발사
  overlay.addEventListener('mousedown', () => {
    if (!gameActive) return;
    const bullet = document.createElement('div');
    bullet.className = 'shoot-bullet';
    overlay.appendChild(bullet);
    
    // 플레이어 머리 위에서 발사
    bullets.push({
      el: bullet,
      x: playerX,
      y: window.innerHeight - 110 // 캐릭터 위쪽에서 시작
    });
  });

  // 적(에러 데이터) 생성기
  let spawnRate = 1000;
  const enemyTypes = ['👾', '🐛', '❌', '❓', '💣'];
  
  const spawnInterval = setInterval(() => {
    if (!gameActive) return;
    const enemy = document.createElement('div');
    enemy.className = 'shoot-enemy';
    enemy.innerHTML = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
    
    const startX = Math.random() * (window.innerWidth - 80) + 40;
    overlay.appendChild(enemy);
    
    enemies.push({
      el: enemy,
      x: startX,
      y: -50,
      speed: Math.random() * 2 + 2 + (score * 0.05) // 점수가 오를수록 빨라짐
    });
  }, spawnRate);

  // 파티클 폭발 효과 함수
  function createExplosion(x, y) {
    for(let i=0; i<8; i++) {
      const p = document.createElement('div');
      p.className = 'shoot-particle';
      overlay.appendChild(p);
      particles.push({
        el: p, x: x, y: y,
        vx: (Math.random() - 0.5) * 15,
        vy: (Math.random() - 0.5) * 15,
        life: 1.0
      });
    }
  }

  // 메인 게임 물리 루프
  function gameLoop() {
    if (!gameActive) return;

    // 1. 총알 이동 처리
    for (let i = bullets.length - 1; i >= 0; i--) {
      let b = bullets[i];
      b.y -= 15; // 레이저 속도
      b.el.style.transform = `translate(calc(${b.x}px - 50%), ${b.y}px)`;

      if (b.y < -50) {
        b.el.remove();
        bullets.splice(i, 1);
      }
    }

    // 2. 적 이동 및 충돌 판정 처리
    for (let i = enemies.length - 1; i >= 0; i--) {
      let e = enemies[i];
      e.y += e.speed;
      
      // 적이 좌우로 살짝씩 흔들리며 내려오게 (어지러운 무빙)
      const sway = Math.sin(e.y * 0.02) * 30;
      e.el.style.transform = `translate(calc(${e.x + sway}px - 50%), ${e.y}px)`;

      // 총알과 적의 충돌 검사
      let hit = false;
      for (let j = bullets.length - 1; j >= 0; j--) {
        let b = bullets[j];
        // 대략적인 사각형 충돌 계산 (Hitbox)
        if (Math.abs(b.x - (e.x + sway)) < 30 && Math.abs(b.y - e.y) < 30) {
          hit = true;
          // 타격 시 처리
          createExplosion(e.x + sway, e.y);
          b.el.remove();
          bullets.splice(j, 1);
          break; // 총알 하나는 적 하나만 부숨
        }
      }

      if (hit) {
        score++;
        scoreDisplay.textContent = score;
        e.el.remove();
        enemies.splice(i, 1);
        continue;
      }

      // 적이 바닥에 닿거나 캐릭터에 닿으면 게임 오버
      if (e.y > window.innerHeight - 80) {
        if (Math.abs((e.x + sway) - playerX) < 40) {
          endGame(); // 몸통 박치기 당함
          return;
        } else if (e.y > window.innerHeight) {
          endGame(); // 바닥 뚫림 (방어 실패)
          return;
        }
      }
    }

    // 3. 파티클(파편) 렌더링
    for (let i = particles.length - 1; i >= 0; i--) {
      let p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.05; // 서서히 사라짐
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.life})`;
      p.el.style.opacity = p.life;

      if (p.life <= 0) {
        p.el.remove();
        particles.splice(i, 1);
      }
    }

    requestAnimationFrame(gameLoop);
  }

  function endGame() {
    gameActive = false;
    clearInterval(spawnInterval);
    document.getElementById('shoot-final-score').textContent = score;
    gameOverScreen.style.display = 'block';
    overlay.style.cursor = 'default';
  }

  document.getElementById('shoot-restart').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
    initShootGame();
  });

  document.getElementById('shoot-exit').addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.remove();
  });

  requestAnimationFrame(gameLoop);
}