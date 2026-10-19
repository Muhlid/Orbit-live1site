// ==========================================
// KENDİ BACKEND LİNKİNİ BURAYA YAZ:
// Link değişirse sadece bu satırı güncelle!
// ==========================================
const BACKEND_URL = "https://orbitlive-j2t2jgf9.b4a.run";

// ==========================================
// 1. MAP & CANVAS INIT
// ==========================================
const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'topright' }).addTo(map);

// Harita Katmanı ve Gece/Gündüz (Terminator) Çizgisi
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
L.terminator({ fillOpacity: 0.3, color: '#000' }).addTo(map);

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

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
// 2. STATE & SOCKET CONNECTION
// ==========================================
const socket = io(BACKEND_URL);

let flights = {}; 
let selectedFlightId = null; 
let knownServers = [];

// Aksiyon Durumları
let isFollowing = false;
let isRouteMode = false;

socket.on('flightDataUpdate', (data) => {
    if (!data) return;
    
    if (data.servers && JSON.stringify(data.servers) !== JSON.stringify(knownServers)) {
        knownServers = data.servers;
        const dropdown = document.getElementById("serverDropdown");
        const currentVal = dropdown.value;
        dropdown.innerHTML = '<option value="ALL">All Servers</option>';
        knownServers.forEach(s => dropdown.innerHTML += `<option value="${s.name}">${s.name} (${s.count})</option>`);
        dropdown.value = currentVal;
    }

    const currentIds = new Set();
    data.result.forEach(f => {
        currentIds.add(f.flightId);
        if (flights[f.flightId]) {
            Object.assign(flights[f.flightId], {
                targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed
            });
            
            const history = flights[f.flightId].history;
            const lastP = history[history.length - 1];
            if (lastP.lat !== f.latitude || lastP.lng !== f.longitude) {
                history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude });
                if (history.length > 25) history.shift(); 
            }

            if (selectedFlightId === f.flightId) updateInfoPanel(flights[f.flightId], false);
        } else {
            flights[f.flightId] = {
                id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, 
                virtualOrg: f.virtualOrganization, serverName: f.serverName, aircraftName: f.aircraftName, liveryName: f.liveryName,
                targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude,
                heading: f.heading, altitude: f.altitude, speed: f.speed, history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }]
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
        if (selectedFlightId && flights[selectedFlightId]) {
            flights[selectedFlightId].fullRoute = details.route || [];
            updateProgressBar(flights[selectedFlightId]); // Rota gelince progress barı hesapla
        }
    }
    document.getElementById('ui-origin').classList.remove('loading');
    document.getElementById('ui-dest').classList.remove('loading');
});

// Kuş uçuşu mesafe hesaplama (Progress Bar İçin)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Dünya yarıçapı km
    const dLat = (lat2-lat1) * Math.PI / 180;
    const dLon = (lon2-lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==========================================
// 3. CANVAS DRAWING
// ==========================================
function getAltitudeColor(alt) {
    if (alt <= 5000) return '#FFFFFF';  
    if (alt <= 10000) return '#FFEA00'; 
    if (alt <= 20000) return '#00FF00'; 
    if (alt <= 30000) return '#00bbff'; 
    if (alt <= 39999) return '#A200FF'; 
    return '#FF0000';                   
}

function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Follow modundaysa haritayı seçili uçağa kilitle
    if (isFollowing && selectedFlightId && flights[selectedFlightId]) {
        const f = flights[selectedFlightId];
        map.panTo([f.lat, f.lng], { animate: false });
    }

    Object.values(flights).forEach(f => {
        // Filtreden geçemeyenleri çizme
        const srv = document.getElementById("serverDropdown").value;
        const term = document.getElementById('topSearch').value.toLowerCase();
        if (srv !== "ALL" && f.serverName !== srv) return;
        if (term && !(f.callsign || "").toLowerCase().includes(term) && !(f.username || "").toLowerCase().includes(term)) return;

        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        const offsets = [-360, 0, 360];
        
        offsets.forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

            // Route modu aktifse diğer uçakları soluklaştır
            if (isRouteMode && selectedFlightId !== f.id) {
                ctx.globalAlpha = 0.2;
            } else {
                ctx.globalAlpha = 1.0;
            }

            // SADECE SEÇİLİ UÇAK İÇİN İRTİFA ÇİZGİSİ VE ROTA ÇİZ
            if (selectedFlightId === f.id) {
                // 1. Kısa Kuyruk İzi Çizimi
                if (f.history.length > 2) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 3.5;
                    for (let i = 1; i < f.history.length - 1; i++) {
                        const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);

                        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                        ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                        const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                        grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt));
                        grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                        ctx.strokeStyle = grad; ctx.stroke();
                    }
                    const lastP = f.history[f.history.length - 1];
                    const prevP = f.history[f.history.length - 2];
                    const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng + offset]);
                    const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng + offset]);
                    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                    ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(p2.x, p2.y, planePos.x, planePos.y);
                    const finalGrad = ctx.createLinearGradient(mid.x, mid.y, planePos.x, planePos.y);
                    finalGrad.addColorStop(0, getAltitudeColor(lastP.alt));
                    finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                    ctx.strokeStyle = finalGrad; ctx.stroke();
                }

                // 2. EĞER ROUTE MODU AÇIKSA VARIŞ NOKTASINA KESİK ÇİZGİ ÇEK
                if (isRouteMode && f.fullRoute && f.fullRoute.length > 0) {
                    const destWp = f.fullRoute[f.fullRoute.length - 1];
                    const destPos = map.latLngToContainerPoint([destWp.lat, destWp.lng + offset]);
                    
                    ctx.beginPath();
                    ctx.setLineDash([8, 8]); // Kesik çizgi ayarı
                    ctx.moveTo(planePos.x, planePos.y);
                    ctx.lineTo(destPos.x, destPos.y);
                    ctx.strokeStyle = "#FF007F"; // Neon Fuşya
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.setLineDash([]); // Diğer çizimleri bozmamak için sıfırla
                }
            }

            // UÇAK İKONU
            ctx.save();
            ctx.translate(planePos.x, planePos.y);
            ctx.rotate(f.heading * Math.PI / 180);
            if (selectedFlightId === f.id) {
                ctx.beginPath(); ctx.arc(0, 0, 22, 0, 2 * Math.PI);
                ctx.fillStyle = "rgba(0, 245, 212, 0.2)"; ctx.fill();
                ctx.strokeStyle = '#00F5D4'; ctx.lineWidth = 2; ctx.stroke();
            }
            ctx.drawImage(planeImg, -14, -14, 28, 28);
            ctx.restore();

            // YAZILAR
            if (userLabel !== "NONE") {
                let text = "";
                if (userLabel === "CALLSIGN") text = f.callsign;
                if (userLabel === "USERNAME") text = f.username || "";
                if (userLabel === "VA") text = f.virtualOrg || "";
                if (userLabel === "LIVERY") text = f.liveryName || "";
                
                if (text !== "") {
                    ctx.fillStyle = userColor; ctx.font = "bold 12px 'Segoe UI', Arial";
                    ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 5;
                    ctx.fillText(text, planePos.x, planePos.y - 22); ctx.shadowBlur = 0; 
                }
            }
        });
    });
    ctx.globalAlpha = 1.0; // Her şey bitince sıfırla
    requestAnimationFrame(drawFlights);
}
drawFlights();

// ==========================================
// 4. UI INTERACTIONS (FOLLOW & ROUTE)
// ==========================================
map.on('click', function(e) {
    if (e.containerPoint.y < 60) return; 

    let clicked = null; let minDistance = 30; 
    Object.values(flights).forEach(f => {
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
    } else { closeInfoPanel(); }
});

// Follow (Takip) Butonu Mantığı
function toggleFollow() {
    isFollowing = !isFollowing;
    const btn = document.getElementById("btn-follow");
    if(isFollowing) {
        btn.classList.add("active-btn");
        btn.innerText = "🎯 Following";
    } else {
        btn.classList.remove("active-btn");
        btn.innerText = "🎯 Follow";
    }
}

// Kullanıcı haritayı elle kaydırırsa Follow'u iptal et
map.on('dragstart', () => {
    if(isFollowing) toggleFollow();
});

// Route Butonu Mantığı (Auto-Fit Bounds)
function toggleRoute() {
    isRouteMode = !isRouteMode;
    const btn = document.getElementById("btn-route");
    if(isRouteMode) {
        btn.classList.add("active-btn");
        btn.innerText = "🔀 Route On";
        
        // Haritayı kalkış ve varış noktasına sığdır
        if(selectedFlightId && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            const origin = [r[0].lat, r[0].lng];
            const dest = [r[r.length-1].lat, r[r.length-1].lng];
            const plane = [flights[selectedFlightId].lat, flights[selectedFlightId].lng];
            map.fitBounds([origin, dest, plane], { padding: [50, 50] });
        }
    } else {
        btn.classList.remove("active-btn");
        btn.innerText = "🔀 Route";
    }
}

function updateProgressBar(f) {
    if(f.fullRoute && f.fullRoute.length > 0) {
        const origin = f.fullRoute[0];
        const dest = f.fullRoute[f.fullRoute.length - 1];
        const totalDist = getDistance(origin.lat, origin.lng, dest.lat, dest.lng);
        const flownDist = getDistance(origin.lat, origin.lng, f.lat, f.lng);
        
        let progress = (flownDist / totalDist) * 100;
        if(progress > 100) progress = 100;
        
        document.getElementById("ui-progress-fill").style.width = progress + "%";
    } else {
        document.getElementById("ui-progress-fill").style.width = "0%";
    }
}

function closeInfoPanel() { 
    document.getElementById('flight-info-panel').classList.remove('active'); 
    selectedFlightId = null; 
    
    // Paneli kapatınca modları da sıfırla
    if(isFollowing) toggleFollow();
    if(isRouteMode) toggleRoute();
}

function applyFilters() { closeInfoPanel(); }
function toggleFilterModal(forceState) { const m = document.getElementById('filter-modal'); forceState === false ? m.classList.remove('active') : m.classList.toggle('active'); }
function toggleSettingsModal() { document.getElementById('settings-modal').classList.toggle('active'); }

function updateInfoPanel(f, requestDetails) {
    document.getElementById('ui-callsign').innerText = f.callsign || "Unknown";
    document.getElementById('ui-username').innerText = f.username || "Guest Pilot";
    document.getElementById('ui-va').innerText = f.virtualOrg || "N/A";
    document.getElementById('ui-aircraft').innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unknown"})`;
    document.getElementById('ui-alt').innerText = Math.round(f.altitude).toLocaleString() + " ft";
    document.getElementById('ui-speed').innerText = Math.round(f.speed) + " kts";
    document.getElementById('ui-heading').innerText = Math.round(f.heading) + "°";
    document.getElementById('ui-server').innerText = f.serverName;
    document.getElementById('ui-progress-fill').style.width = "0%"; // Sıfırla

    if (requestDetails) {
        document.getElementById('ui-origin').innerText = "Loading...";
        document.getElementById('ui-origin').classList.add('loading');
        document.getElementById('ui-dest').innerText = "Loading...";
        document.getElementById('ui-dest').classList.add('loading');
        socket.emit('requestFlightDetails', { sessionId: f.sessionId, flightId: f.id });
    } else {
        updateProgressBar(f); // Zaten açıksa barı canlı güncelle
    }
}
