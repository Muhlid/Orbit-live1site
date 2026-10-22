// ==========================================
// 1. AYARLAR VE HARİTA KURULUMU
// ==========================================
// BURAYA VERCEL'DEKİ BACKEND PROJENİN LİNKİNİ YAZ (Sonunda /api/flights OLACAK)
const API_URL = "https://orbtlive.vercel.app/api/flights"; // Vercel linkini buraya koy

const map = L.map('map', { 
    center: [39.0, 35.0], 
    zoom: 5, 
    minZoom: 2, 
    zoomControl: false, 
    worldCopyJump: true 
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Koyu / Gece Harita Katmanı (Esri Dark Canvas)
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { 
    maxZoom: 16 
}).addTo(map);

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() { 
    const container = document.getElementById('map-container');
    canvas.width = container.clientWidth; 
    canvas.height = container.clientHeight; 
}
window.addEventListener('resize', resizeCanvas); 
resizeCanvas();

let userColor = "#00F5D4"; 
let userLabel = "CALLSIGN";
let planeImg = new Image();

function updateSettings() {
    userColor = document.getElementById("planeColorPicker").value;
    userLabel = document.getElementById("planeLabelSelect").value;
    const svgColor = encodeURIComponent(userColor); 
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
}
updateSettings();

// ==========================================
// 2. VERCEL API'DEN VERİ ÇEKME (POLLING)
// ==========================================
let flights = {}; 
let selectedFlightId = null; 
let knownServers = [];
let isFollowing = false;
let isRouteMode = false;

// Socket.io yerine fetch() ile verileri çekiyoruz
async function fetchFlightData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error("API Connection Failed");
        const data = await response.json();
        
        if (!data || !data.result) return;
        
        // Sunucu Listesini Güncelle (Aktif kullanıcı sayısı artık API'den gelmiyorsa sadece isimleri alıyoruz)
        const uniqueServers = [...new Set(data.result.map(f => f.serverName || f.sessionId))];
        if (JSON.stringify(uniqueServers) !== JSON.stringify(knownServers)) {
            knownServers = uniqueServers;
            const dropdown = document.getElementById("serverDropdown");
            const currentVal = dropdown.value;
            dropdown.innerHTML = '<option value="ALL">All Servers</option>';
            knownServers.forEach(s => {
                dropdown.innerHTML += `<option value="${s}">${s}</option>`;
            });
            dropdown.value = currentVal;
        }

        const currentIds = new Set();
        data.result.forEach(f => {
            currentIds.add(f.flightId);
            if (flights[f.flightId]) {
                Object.assign(flights[f.flightId], {
                    targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed
                });
                
                // Renkli irtifa geçmişi (maksimum 45 nokta)
                const history = flights[f.flightId].history;
                const lastP = history[history.length - 1];
                if (lastP.lat !== f.latitude || lastP.lng !== f.longitude) {
                    history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude });
                    if (history.length > 45) history.shift(); 
                }
            } else {
                flights[f.flightId] = {
                    id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, 
                    virtualOrg: f.virtualOrganization, serverName: f.serverName || f.sessionId, aircraftName: f.aircraftName, liveryName: f.liveryName,
                    targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude,
                    heading: f.heading, altitude: f.altitude, speed: f.speed, history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }]
                };
            }
        });

        // Oyundan çıkanları temizle
        Object.keys(flights).forEach(id => {
            if (!currentIds.has(id)) {
                delete flights[id];
                if (selectedFlightId === id) closeInfoPanel(); 
            }
        });
    } catch (err) {
        console.error("Fetch Error:", err);
    }
}

// Uçuş detaylarını (Rota) çekmek için artık Socket kullanmıyoruz, 
// Eğer Vercel'de bu API rotasını oluşturmadıysan şimdilik rotayı çizmeyi atlıyoruz.
async function requestFlightDetails(sessionId, flightId) {
    // ŞİMDİLİK İPTAL EDİLDİ: Uçuş planı API'si Vercel'e eklenmediği için boş dönüyoruz.
    // Eğer uçuş planını da Vercel'e eklersen, buraya fetch(`.../api/flightplan?session=${sessionId}&flight=${flightId}`) yazacağız.
    document.getElementById('ui-origin').innerText = "N/A";
    document.getElementById('ui-dest').innerText = "N/A";
    document.getElementById('ui-origin').classList.remove('loading');
    document.getElementById('ui-dest').classList.remove('loading');
    
    if (selectedFlightId && flights[selectedFlightId]) {
        flights[selectedFlightId].fullRoute = []; // Rota yok
        updateCalculatedData(flights[selectedFlightId]); 
    }
}

// İlk veriyi çek ve sonra her 15 saniyede bir çekmeye devam et
fetchFlightData();
setInterval(fetchFlightData, 15000);

// ==========================================
// 3. HAVACILIK HESAPLAMALARI & RENKLER
// ==========================================
function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.1; // Deniz mili (NM)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getAltitudeColor(alt) {
    if (alt <= 5000) return '#FFFFFF';  
    if (alt <= 10000) return '#FFEA00'; 
    if (alt <= 20000) return '#00FF00'; 
    if (alt <= 30000) return '#00bbff'; 
    if (alt <= 39999) return '#A200FF'; 
    return '#FF0000';                   
}

function matchesFilters(f) {
    const srv = document.getElementById("serverDropdown").value;
    const term = document.getElementById('topSearch').value.trim().toLowerCase();
    
    if (srv !== "ALL" && f.serverName !== srv) return false;
    
    if (term) {
        const cs = (f.callsign || "").toLowerCase();
        const un = (f.username || "").toLowerCase();
        const va = (f.virtualOrg || "").toLowerCase();
        if (!cs.includes(term) && !un.includes(term) && !va.includes(term)) return false;
    }
    
    // Detaylı Modal Filtreleri
    const fOrigin = document.getElementById('fltOrigin').value.trim().toUpperCase();
    const fDest = document.getElementById('fltDest').value.trim().toUpperCase();
    const fLivery = document.getElementById('fltLivery').value.trim().toLowerCase();
    const fCallsign = document.getElementById('fltCallsign').value.trim().toLowerCase();
    const fVA = document.getElementById('fltVA').value.trim().toLowerCase();
    const fPilot = document.getElementById('fltPilot').value.trim().toLowerCase();

    if (fLivery && !(f.liveryName || "").toLowerCase().includes(fLivery)) return false;
    if (fCallsign && !(f.callsign || "").toLowerCase().includes(fCallsign)) return false;
    if (fVA && !(f.virtualOrg || "").toLowerCase().includes(fVA)) return false;
    if (fPilot && !(f.username || "").toLowerCase().includes(fPilot)) return false;

    return true;
}

// ==========================================
// 4. CANVAS ÇİZİMİ (SÜZÜLME & İRTİFA ÇİZGİLERİ)
// ==========================================
function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isFollowing && selectedFlightId && flights[selectedFlightId]) {
        map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });
    }

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        if (isRouteMode && selectedFlightId !== f.id) return;

        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        const offsets = [-360, 0, 360]; 
        
        offsets.forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -80 || planePos.x > canvas.width + 80 || planePos.y < -80 || planePos.y > canvas.height + 80) return;

            if (selectedFlightId === f.id) {
                // Sadece kısa geçmiş izi çizilir (Uçuş planı API'si Vercel'e eklenene kadar)
                if (f.history.length > 2) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    for (let i = 1; i < f.history.length - 1; i++) {
                        const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);

                        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                        if (mid1.x !== mid2.x || mid1.y !== mid2.y) {
                            ctx.beginPath();
                            ctx.moveTo(mid1.x, mid1.y);
                            ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                            const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                            grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt));
                            grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                            ctx.strokeStyle = grad;
                            ctx.globalAlpha = 0.9;
                            ctx.stroke();
                        }
                    }
                }
            }

            ctx.save();
            ctx.translate(planePos.x, planePos.y);
            ctx.rotate(f.heading * Math.PI / 180);
            ctx.drawImage(planeImg, -14, -14, 28, 28);
            ctx.restore();

            if (userLabel !== "NONE") {
                let text = "";
                if (userLabel === "CALLSIGN") text = f.callsign;
                if (userLabel === "USERNAME") text = f.username || "";
                if (userLabel === "VA") text = f.virtualOrg || "";
                if (userLabel === "LIVERY") text = f.liveryName || "";
                
                if (text !== "") {
                    ctx.fillStyle = userColor;
                    ctx.font = "bold 11px -apple-system, BlinkMacSystemFont, 'Segoe UI'";
                    ctx.textAlign = "center";
                    ctx.shadowColor = "#000";
                    ctx.shadowBlur = 4;
                    ctx.fillText(text, planePos.x, planePos.y - 20);
                    ctx.shadowBlur = 0;
                }
            }
        });
    });

    requestAnimationFrame(drawFlights);
}
drawFlights();

// ==========================================
// 5. TIKLAMA HASSASİYETİ & BİLGİ KARTI TETİKLEME
// ==========================================
function handleSelection(x, y) {
    if (y < 80) return; 

    let clicked = null;
    let minDistance = 45; 

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        [-360, 0, 360].forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            const dist = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
            if (dist < minDistance) {
                minDistance = dist;
                clicked = f;
            }
        });
    });

    if (clicked) {
        selectedFlightId = clicked.id;
        
        document.getElementById('ui-callsign').innerText = clicked.callsign || "Unknown";
        document.getElementById('ui-aircraft').innerText = clicked.aircraftName || "Aircraft";
        document.getElementById('ui-va').innerText = clicked.virtualOrg || "General Aviation";
        document.getElementById('ui-alt').innerText = Math.round(clicked.altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(clicked.speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(clicked.heading) + "°";
        
        document.getElementById('ui-origin').innerText = "Loading...";
        document.getElementById('ui-dest').innerText = "Loading...";
        document.getElementById('ui-origin').classList.add('loading');
        document.getElementById('ui-dest').classList.add('loading');
        
        requestFlightDetails(clicked.sessionId, clicked.id);
        updateCalculatedData(clicked);

        document.getElementById('flight-info-panel').classList.add('active');
    } else {
        closeInfoPanel();
    }
}

map.on('click', (e) => handleSelection(e.containerPoint.x, e.containerPoint.y));
map.on('dragstart', () => { if (isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing;
    const btn = document.getElementById("btn-follow");
    if (isFollowing) {
        btn.classList.add("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg><span>Following</span>`;
    } else {
        btn.classList.remove("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg><span>Follow</span>`;
    }
}

function toggleRoute() {
    isRouteMode = !isRouteMode;
    const btn = document.getElementById("btn-route");
    if (isRouteMode) {
        btn.classList.add("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg><span>Route On</span>`;
    } else {
        btn.classList.remove("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg><span>Route</span>`;
    }
}

setInterval(() => {
    if (selectedFlightId && flights[selectedFlightId]) {
        const f = flights[selectedFlightId];
        updateCalculatedData(f);
        document.getElementById('ui-alt').innerText = Math.round(f.altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(f.speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(f.heading) + "°";
    }
}, 1000);

function updateCalculatedData(f) {
    if (!f.fullRoute || f.fullRoute.length === 0) {
        document.getElementById('ui-flown').innerText = "--- nm";
        document.getElementById('ui-remaining').innerText = "--- nm";
        document.getElementById('ui-dep-time').innerText = "---";
        document.getElementById('ui-eta').innerText = "---";
        document.getElementById('ui-next-wp').innerText = "---";
        document.getElementById("ui-progress-fill").style.width = "0%";
        return;
    }
}

function closeInfoPanel() { 
    document.getElementById('flight-info-panel').classList.remove('active'); 
    selectedFlightId = null; 
    if (isFollowing) toggleFollow();
    if (isRouteMode) toggleRoute();
}

function applyFilters() { 
    toggleFilterModal(false); 
}

function toggleFilterModal(forceState) { 
    const m = document.getElementById('filter-modal'); 
    if (forceState === false) m.classList.remove('active');
    else m.classList.toggle('active');
}

function toggleSettingsModal() { 
    document.getElementById('settings-modal').classList.toggle('active'); 
}
