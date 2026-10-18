// ==========================================
// 1. MAP & CANVAS INIT
// ==========================================
// worldCopyJump: true -> Haritanın sağa/sola sonsuz döngüde kaymasını sağlar
const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

let userColor = "#00F5D4"; // Neon Cyan varsayılan
let userLabel = "CALLSIGN";
let planeImg = new Image();

function updateSettings() {
    userColor = document.getElementById("planeColorPicker").value;
    userLabel = document.getElementById("planeLabelSelect").value;
    const svgColor = encodeURIComponent(userColor); 
    // Yüksek kaliteli SVG Uçak İkonu
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
}
updateSettings();

// ==========================================
// 2. SOCKET CONNECTION & DATA
// ==========================================
const socket = io("https://orbitlive-9v23ykd1.b4a.run"); // YENİ LINK!

let flights = {}; 
let selectedFlightId = null; 
let knownServers = [];

socket.on('flightDataUpdate', (data) => {
    if (!data) return;
    
    // Server Listesini Aktif Kullanıcı Sayılarıyla Güncelleme
    if (data.servers && JSON.stringify(data.servers) !== JSON.stringify(knownServers)) {
        knownServers = data.servers;
        const dropdown = document.getElementById("serverDropdown");
        const currentVal = dropdown.value;
        dropdown.innerHTML = '<option value="ALL">All Servers</option>';
        knownServers.forEach(s => {
            dropdown.innerHTML += `<option value="${s.name}">${s.name} (${s.count})</option>`;
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
            
            // Trail (Kuyruk) Geçmişi Güncelleme
            const history = flights[f.flightId].history;
            const lastP = history[history.length - 1];
            if (lastP.lat !== f.latitude || lastP.lng !== f.longitude) {
                history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude });
                if (history.length > 25) history.shift(); // Max 25 nokta tutar (Performans)
            }

            if (selectedFlightId === f.flightId) updateInfoPanel(flights[f.flightId], false);
        } else {
            flights[f.flightId] = {
                id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, 
                virtualOrg: f.virtualOrganization, serverName: f.serverName, 
                aircraftName: f.aircraftName, liveryName: f.liveryName,
                targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude,
                heading: f.heading, altitude: f.altitude, speed: f.speed,
                history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }]
            };
        }
    });

    Object.keys(flights).forEach(id => {
        if (!currentIds.has(id)) {
            delete flights[id];
            if (selectedFlightId === id) closeInfoPanel(); 
        }
    });
});

socket.on('flightDetailsData', (details) => {
    if (details) {
        document.getElementById('ui-origin').innerText = details.originAirport;
        document.getElementById('ui-dest').innerText = details.destinationAirport;
    }
    document.getElementById('ui-origin').classList.remove('loading');
    document.getElementById('ui-dest').classList.remove('loading');
});

// ==========================================
// 3. FILTERING & SEARCH LOGIC
// ==========================================
function matchesFilters(f) {
    const srv = document.getElementById("serverDropdown").value;
    if (srv !== "ALL" && f.serverName !== srv) return false;

    const term = document.getElementById('topSearch').value.toLowerCase();
    if (term) {
        const cs = (f.callsign || "").toLowerCase();
        const un = (f.username || "").toLowerCase();
        if (!cs.includes(term) && !un.includes(term)) return false;
    }

    // Advanced Filters
    const va = document.getElementById('fltVA').value.toLowerCase();
    if (va && !(f.virtualOrg || "").toLowerCase().includes(va)) return false;

    const livery = document.getElementById('fltLivery').value.toLowerCase();
    if (livery && !(f.liveryName || "").toLowerCase().includes(livery)) return false;

    const acCallsign = document.getElementById('fltCallsign').value.toLowerCase();
    if (acCallsign && !(f.callsign || "").toLowerCase().includes(acCallsign)) return false;

    const pilot = document.getElementById('fltPilot').value.toLowerCase();
    if (pilot && !(f.username || "").toLowerCase().includes(pilot)) return false;

    return true;
}

function applyFilters() {
    toggleFilterModal(false); // Modal'ı kapat
    closeInfoPanel();
}

// ==========================================
// 4. CANVAS DRAWING (Infinite World + Bezier Trails)
// ==========================================
function getAltitudeColor(alt) {
    if (alt < 10000) return '#FF007F'; // Alçak - Neon Pink
    if (alt < 25000) return '#00F5D4'; // Orta - Neon Cyan
    return '#00A8E8';                  // Yüksek - Mavi
}

function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;

        // Yumuşak kayma animasyonu (Lag Fix)
        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        // SONSÜZ DÜNYA DÖNGÜSÜ (Ekranda görünmesi için -360, 0 ve +360 boylamlarında çizim yapıyoruz)
        const offsets = [-360, 0, 360];
        
        offsets.forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (pos.x < -50 || pos.x > canvas.width + 50 || pos.y < -50 || pos.y > canvas.height + 50) return;

            // --- KUSURSUZ RENKLİ İRTİFA ÇİZGİSİ (RGB GRADIENT & BEZIER CURVE) ---
            if (f.history.length > 2) {
                ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 3.5;

                for (let i = 1; i < f.history.length - 1; i++) {
                    const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                    const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                    const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);

                    const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                    const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                    ctx.beginPath();
                    ctx.moveTo(mid1.x, mid1.y);
                    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);

                    const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                    grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt));
                    grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                    
                    ctx.strokeStyle = grad; ctx.globalAlpha = 0.8; ctx.stroke();
                }

                // Son segmenti uçağa bağla
                const lastP = f.history[f.history.length - 1];
                const prevP = f.history[f.history.length - 2];
                const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng + offset]);
                const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng + offset]);
                const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                ctx.beginPath();
                ctx.moveTo(mid.x, mid.y);
                ctx.quadraticCurveTo(p2.x, p2.y, pos.x, pos.y);
                const finalGrad = ctx.createLinearGradient(mid.x, mid.y, pos.x, pos.y);
                finalGrad.addColorStop(0, getAltitudeColor(lastP.alt));
                finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                ctx.strokeStyle = finalGrad; ctx.stroke(); ctx.globalAlpha = 1.0;
            }

            // --- UÇAK İKONU VE VURGU ---
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.rotate(f.heading * Math.PI / 180);
            if (selectedFlightId === f.id) {
                ctx.beginPath(); ctx.arc(0, 0, 20, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(0, 245, 212, 0.25)"; ctx.fill();
                ctx.strokeStyle = '#00F5D4'; ctx.lineWidth = 2; ctx.stroke();
            }
            ctx.drawImage(planeImg, -14, -14, 28, 28);
            ctx.restore();

            // --- YAZILAR ---
            if (userLabel !== "NONE") {
                let text = "";
                if (userLabel === "CALLSIGN") text = f.callsign;
                if (userLabel === "USERNAME") text = f.username || "";
                if (userLabel === "VA") text = f.virtualOrg || "";
                if (userLabel === "LIVERY") text = f.liveryName || "";
                
                if (text !== "") {
                    ctx.fillStyle = userColor; ctx.font = "bold 12px 'Segoe UI', Arial";
                    ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 5;
                    ctx.fillText(text, pos.x, pos.y - 22); ctx.shadowBlur = 0; 
                }
            }
        });
    });
    requestAnimationFrame(drawFlights);
}
drawFlights();

// ==========================================
// 5. UI INTERACTIONS & CLICKS
// ==========================================
map.on('click', function(e) {
    if (e.containerPoint.y < 60) return; // Üst menü tıklamalarını yoksay

    let clicked = null; let minDistance = 30; // Piksel hassasiyeti
    
    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        
        // Sonsuz haritada tıklanan uçağı bulabilmek için offsetleri de kontrol et
        [-360, 0, 360].forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDistance) { minDistance = dist; clicked = f; }
        });
    });
    
    if (clicked) { 
        selectedFlightId = clicked.id; 
        updateInfoPanel(clicked, true); 
        document.getElementById('flight-info-panel').classList.add('active'); 
    } else {
        closeInfoPanel();
    }
});

function toggleFilterModal(forceState) {
    const modal = document.getElementById('filter-modal');
    if (forceState === false) modal.classList.remove('active');
    else modal.classList.toggle('active');
}

function toggleSettingsModal() { document.getElementById('settings-modal').classList.toggle('active'); }
function closeInfoPanel() { document.getElementById('flight-info-panel').classList.remove('active'); selectedFlightId = null; }

function updateInfoPanel(f, requestDetails) {
    document.getElementById('ui-callsign').innerText = f.callsign || "Unknown";
    document.getElementById('ui-username').innerText = f.username || "Guest Pilot";
    document.getElementById('ui-va').innerText = f.virtualOrg || "N/A";
    document.getElementById('ui-aircraft').innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unknown"})`;
    document.getElementById('ui-alt').innerText = Math.round(f.altitude).toLocaleString() + " ft";
    document.getElementById('ui-speed').innerText = Math.round(f.speed) + " kts";
    document.getElementById('ui-server').innerText = f.serverName;

    if (requestDetails) {
        document.getElementById('ui-origin').innerText = "Loading...";
        document.getElementById('ui-origin').classList.add('loading');
        document.getElementById('ui-dest').innerText = "Loading...";
        document.getElementById('ui-dest').classList.add('loading');
        socket.emit('requestFlightDetails', { sessionId: f.sessionId, flightId: f.id });
    }
}
