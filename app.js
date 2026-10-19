const BACKEND_URL = "https://orbitlive-j2t2jgf9.b4a.run";

const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);

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

const socket = io(BACKEND_URL);

let flights = {}; 
let selectedFlightId = null; 
let knownServers = [];
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
                if (history.length > 50) history.shift(); // İrtifa çizgisi uzunluğu artırıldı (50 nokta)
            }
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
            updateCalculatedData(flights[selectedFlightId]); 
        }
    }
    document.getElementById('ui-origin').classList.remove('loading');
    document.getElementById('ui-dest').classList.remove('loading');
});

// Mesafe Hesaplama (Nautical Miles - nm)
function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.1; // Dünya yarıçapı (nautical miles)
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
    const term = document.getElementById('topSearch').value.toLowerCase();
    if (srv !== "ALL" && f.serverName !== srv) return false;
    if (term && !(f.callsign || "").toLowerCase().includes(term) && !(f.username || "").toLowerCase().includes(term)) return false;
    return true;
}

function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isFollowing && selectedFlightId && flights[selectedFlightId]) {
        map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });
    }

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;

        // ROTA MODU AÇIKSA DİĞER TÜM UÇAKLARI TAMAMEN GİZLE
        if (isRouteMode && selectedFlightId !== f.id) return;

        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        const offsets = [-360, 0, 360];
        
        offsets.forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

            // SADECE SEÇİLİ UÇAĞIN İRTİFA ÇİZGİSİNİ VE ROTASINI ÇİZ
            if (selectedFlightId === f.id) {
                
                // 1. Arkadaki Renkli İrtifa Çizgisi
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

                // 2. ÖNDEKİ KESİK ÇİZGİLİ ROTA VE İSİMLER
                if (isRouteMode && f.fullRoute && f.fullRoute.length > 0) {
                    let closestWpIndex = 0; let minWpDist = Infinity;
                    for(let i = 0; i < f.fullRoute.length; i++) {
                        const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2);
                        if(dist < minWpDist) { minWpDist = dist; closestWpIndex = i; }
                    }

                    ctx.beginPath();
                    ctx.setLineDash([6, 6]); // Kesik çizgi
                    ctx.lineWidth = 2;
                    ctx.moveTo(planePos.x, planePos.y);

                    // Uçağın önündeki kalan ara noktaları çiz
                    for(let i = closestWpIndex + 1; i < f.fullRoute.length; i++) {
                        const wp = f.fullRoute[i];
                        const wpPos = map.latLngToContainerPoint([wp.lat, wp.lng + offset]);
                        ctx.lineTo(wpPos.x, wpPos.y);

                        // Ara nokta ismini yazdır
                        if(wp.name) {
                            ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial";
                            ctx.fillText(wp.name, wpPos.x, wpPos.y - 8);
                        }
                    }
                    ctx.strokeStyle = "#00F5D4"; 
                    ctx.stroke();
                    ctx.setLineDash([]); 
                }
            }

            // UÇAK İKONU
            ctx.save();
            ctx.translate(planePos.x, planePos.y);
            ctx.rotate(f.heading * Math.PI / 180);
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
                    ctx.fillStyle = userColor; ctx.font = "bold 12px Arial";
                    ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 5;
                    ctx.fillText(text, planePos.x, planePos.y - 22); ctx.shadowBlur = 0; 
                }
            }
        });
    });
    requestAnimationFrame(drawFlights);
}
drawFlights();

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

map.on('dragstart', () => { if(isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing;
    const btn = document.getElementById("btn-follow");
    if(isFollowing) { btn.classList.add("active-btn"); btn.innerHTML = "🎯 Following"; } 
    else { btn.classList.remove("active-btn"); btn.innerHTML = "🎯 Follow"; }
}

function toggleRoute() {
    isRouteMode = !isRouteMode;
    const btn = document.getElementById("btn-route");
    if(isRouteMode) {
        btn.classList.add("active-btn");
        btn.innerHTML = "🔀 Route On";
        if(selectedFlightId && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            const origin = [r[0].lat, r[0].lng];
            const dest = [r[r.length-1].lat, r[r.length-1].lng];
            const plane = [flights[selectedFlightId].lat, flights[selectedFlightId].lng];
            map.fitBounds([origin, dest, plane], { padding: [50, 50] });
        }
    } else {
        btn.classList.remove("active-btn");
        btn.innerHTML = "🔀 Route";
    }
}

// Saniyede 1 kez veri güncellemesi (Mesafe ve Saat Hesaplamaları)
setInterval(() => {
    if (selectedFlightId && flights[selectedFlightId]) {
        updateCalculatedData(flights[selectedFlightId]);
        document.getElementById('ui-alt').innerText = Math.round(flights[selectedFlightId].altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(flights[selectedFlightId].speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(flights[selectedFlightId].heading) + "°";
    }
}, 1000);

function updateCalculatedData(f) {
    if(!f.fullRoute || f.fullRoute.length === 0) {
        document.getElementById('ui-flown').innerText = "--- nm";
        document.getElementById('ui-remaining').innerText = "--- nm";
        document.getElementById('ui-dep-time').innerText = "---";
        document.getElementById('ui-eta').innerText = "---";
        document.getElementById('ui-next-wp').innerText = "---";
        document.getElementById("ui-progress-fill").style.width = "0%";
        return;
    }
    
    const origin = f.fullRoute[0];
    const dest = f.fullRoute[f.fullRoute.length - 1];
    
    // Mesafe Hesaplamaları
    const flownDist = getDistanceNM(origin.lat, origin.lng, f.lat, f.lng);
    const remainingDist = getDistanceNM(f.lat, f.lng, dest.lat, dest.lng);
    
    document.getElementById('ui-flown').innerText = Math.round(flownDist) + " nm";
    document.getElementById('ui-remaining').innerText = Math.round(remainingDist) + " nm";
    
    // Zaman Hesaplamaları (Hız 50 kts üzerindeyse)
    if (f.speed > 50) {
        const now = new Date();
        const remainingHours = remainingDist / f.speed;
        const etaTime = new Date(now.getTime() + remainingHours * 3600000);
        document.getElementById('ui-eta').innerText = etaTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const flownHours = flownDist / f.speed;
        const depTime = new Date(now.getTime() - flownHours * 3600000);
        document.getElementById('ui-dep-time').innerText = depTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } else {
        document.getElementById('ui-eta').innerText = "N/A";
        document.getElementById('ui-dep-time').innerText = "N/A";
    }
    
    // Sonraki Ara Nokta Bulma
    let closestWpIndex = 0; let minWpDist = Infinity;
    for(let i = 0; i < f.fullRoute.length; i++) {
        const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2);
        if(dist < minWpDist) { minWpDist = dist; closestWpIndex = i; }
    }
    const nextWp = f.fullRoute[closestWpIndex + 1] || f.fullRoute[f.fullRoute.length - 1];
    document.getElementById('ui-next-wp').innerText = nextWp ? nextWp.name : "N/A";
    
    // Progress Bar
    const totalDist = flownDist + remainingDist;
    let progress = (flownDist / totalDist) * 100;
    if(progress > 100) progress = 100;
    document.getElementById("ui-progress-fill").style.width = progress + "%";
}

function closeInfoPanel() { 
    document.getElementById('flight-info-panel').classList.remove('active'); 
    selectedFlightId = null; 
    if(isFollowing) toggleFollow();
    if(isRouteMode) toggleRoute();
}

function applyFilters() { toggleFilterModal(false); closeInfoPanel(); }
function toggleFilterModal(forceState) { const m = document.getElementById('filter-modal'); forceState === false ? m.classList.remove('active') : m.classList.toggle('active'); }
function toggleSettingsModal() { document.getElementById('settings-modal').classList.toggle('active'); }

function updateInfoPanel(f, requestDetails) {
    document.getElementById('ui-callsign').innerText = f.callsign || "Unknown";
    document.getElementById('ui-username').innerText = f.username || "Guest Pilot";
    document.getElementById('ui-va').innerText = f.virtualOrg || "N/A";
    document.getElementById('ui-aircraft').innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unknown"})`;
    
    if (requestDetails) {
        document.getElementById('ui-origin').innerHTML = '<span class="loading">Loading...</span>';
        document.getElementById('ui-dest').innerHTML = '<span class="loading">Loading...</span>';
        socket.emit('requestFlightDetails', { sessionId: f.sessionId, flightId: f.id });
    }
        }
