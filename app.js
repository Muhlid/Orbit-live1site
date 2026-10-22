// ==========================================
// 1. AYARLAR VE HARİTA KURULUMU
// ==========================================
const API_URL = "https://orbtlive.vercel.app/api/flights"; 
const DETAILS_API_URL = "https://orbtlive.vercel.app/api/details"; 

const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { const container = document.getElementById('map-container'); canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

let userColor = "#00F5D4"; let userLabel = "CALLSIGN";
let showATC = true, showAirports = true, showTracks = true;
const planeImg = new Image();

// STATIC KATMANLAR (ATC, Havalimanı ve Rotalar)
const atcLayer = L.layerGroup().addTo(map);
const aptLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);

// KAYMA SORUNU ÇÖZÜMÜ: iconAnchor ayarları [12,12] ve [8,8] yapılarak haritaya tam ortalarından çivilendi!
const atcIconSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF007F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L12 22 M8 22L16 22 M12 2A4 4 0 0 0 8 6 M12 2A4 4 0 0 1 16 6 M12 2A8 8 0 0 0 4 10 M12 2A8 8 0 0 1 20 10"/></svg>`;
const aptIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E9AAF" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>`;

const atcLeafletIcon = L.divIcon({ className: 'custom-map-icon atc-icon', html: atcIconSvg, iconSize: [24,24], iconAnchor: [12,12] });
const aptLeafletIcon = L.divIcon({ className: 'custom-map-icon apt-icon', html: aptIconSvg, iconSize: [16,16], iconAnchor: [8,8] });

function updateSettings() {
    const cp = document.getElementById("planeColorPicker"); if(cp) userColor = cp.value;
    const ls = document.getElementById("planeLabelSelect"); if(ls) userLabel = ls.value;
    const svgColor = encodeURIComponent(userColor); 
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
}
updateSettings();

function updateStaticLayers() {
    const ta = document.getElementById("toggleAtc"); showATC = ta ? ta.checked : true;
    const tap = document.getElementById("toggleAirports"); showAirports = tap ? tap.checked : true;
    const tt = document.getElementById("toggleTracks"); showTracks = tt ? tt.checked : true;
    renderStaticData();
}

let flights = {}, atcData = [], airportsData = [], tracksData = [];
let selectedFlightId = null, knownServers = [], currentServerFilter = "ALL";
let isFollowing = false, isRouteMode = false;

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.atc) atcData = data.atc;
        if (data.airports) airportsData = data.airports;
        if (data.tracks) tracksData = data.tracks;

        renderStaticData(); 

        if (data.result) {
            const uniqueServers = [...new Set(data.result.map(f => f.serverName || f.sessionId))];
            if (JSON.stringify(uniqueServers) !== JSON.stringify(knownServers)) {
                knownServers = uniqueServers;
                renderServerButtons();
            }

            const currentIds = new Set();
            data.result.forEach(f => {
                currentIds.add(f.flightId);
                if (flights[f.flightId]) {
                    Object.assign(flights[f.flightId], { targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed });
                    const history = flights[f.flightId].history;
                    const lastP = history[history.length - 1];
                    if (lastP.lat !== f.latitude || lastP.lng !== f.longitude) { history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude }); if (history.length > 50) history.shift(); }
                } else {
                    flights[f.flightId] = {
                        id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, virtualOrg: f.virtualOrganization, serverName: f.serverName || f.sessionId, aircraftName: f.aircraftName, liveryName: f.liveryName,
                        targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed, history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }], fullRoute: []
                    };
                }
            });

            Object.keys(flights).forEach(id => {
                if (!currentIds.has(id)) { delete flights[id]; if (selectedFlightId === id) closeInfoPanel(); }
            });
        }
    } catch(e) {}
}

fetchFlightData();
setInterval(fetchFlightData, 12000);

function parseOceanicWp(wpStr) { const m = wpStr.match(/^(\d{2})\/(\d{2})$/); return m ? {lat: parseInt(m[1]), lng: -parseInt(m[2])} : null; }

function renderStaticData() {
    atcLayer.clearLayers(); aptLayer.clearLayers(); trackLayer.clearLayers();

    if (showTracks && !isRouteMode) {
        tracksData.forEach(t => {
            if(!t.path) return;
            let latlngs = [];
            t.path.forEach(wp => { const c = parseOceanicWp(wp); if(c) latlngs.push([c.lat, c.lng]); });
            L.polyline(latlngs, {color: '#FF007F', weight: 1, opacity: 0.4}).addTo(trackLayer);
        });
    }

    if (showAirports && !isRouteMode) {
        airportsData.forEach(ap => {
            if(!ap.has3D) return;
            const marker = L.marker([ap.latitude, ap.longitude], {icon: aptLeafletIcon}).addTo(aptLayer);
            
            // KAPANMA HATASI ÇÖZÜMÜ: L.DomEvent.stopPropagation(e) ile harita tıklamasını iptal ediyoruz
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                closeInfoPanel();
                document.getElementById('ui-apt-icao').innerText = ap.icao;
                document.getElementById('ui-apt-name').innerText = ap.name;
                document.getElementById('ui-apt-city').innerText = ap.city || "Unknown City";
                document.getElementById('ui-apt-elev').innerText = ap.elevation ? ap.elevation + " ft" : "---";
                const p = document.getElementById('airport-info-panel'); p.classList.remove('hidden'); p.classList.add('active');
            });
        });
    }

    if (showATC && !isRouteMode) {
        atcData.forEach(atc => {
            if (currentServerFilter !== "ALL" && atc.serverName && atc.serverName !== currentServerFilter) return;
            const marker = L.marker([atc.latitude, atc.longitude], {icon: atcLeafletIcon}).addTo(atcLayer);
            
            // KAPANMA HATASI ÇÖZÜMÜ: L.DomEvent.stopPropagation(e)
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                closeInfoPanel();
                const types = ["Ground","Tower","Unicom","Clearance","Approach","Departure","Center","ATIS"];
                document.getElementById('ui-atc-icao').innerText = atc.airportName || "CENTER";
                document.getElementById('ui-atc-type').innerText = types[atc.type] || "ATC";
                document.getElementById('ui-atc-user').innerText = `Controller: ${atc.username || "Anonymous"}`;
                document.getElementById('ui-atc-atis').innerText = "Fetching ATIS...";
                
                fetch(`${DETAILS_API_URL}?type=atis&session=${atc.sessionId}&icao=${atc.airportName}`)
                    .then(res => res.json())
                    .then(data => { document.getElementById('ui-atc-atis').innerText = data.atis || "No ATIS available."; })
                    .catch(()=>{});
                
                const p = document.getElementById('atc-info-panel'); p.classList.remove('hidden'); p.classList.add('active');
            });
        });
    }
}

function renderServerButtons() {
    const container = document.getElementById("server-buttons");
    if(!container) return;
    let html = `<button class="server-btn ${currentServerFilter === 'ALL' ? 'active' : ''}" onclick="setServerFilter('ALL')">All Servers</button>`;
    knownServers.forEach(srv => {
        if(srv !== "Live Server") {
            html += `<button class="server-btn ${currentServerFilter === srv ? 'active' : ''}" onclick="setServerFilter('${srv}')">${srv}</button>`;
        }
    });
    container.innerHTML = html;
}

function setServerFilter(srv) { currentServerFilter = srv; renderServerButtons(); closeInfoPanel(); renderStaticData(); }

function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.1; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getAltitudeColor(alt) { if (alt <= 5000) return '#FFFFFF'; if (alt <= 10000) return '#FFEA00'; if (alt <= 20000) return '#00FF00'; if (alt <= 30000) return '#00bbff'; if (alt <= 39999) return '#A200FF'; return '#FF0000'; }

function matchesFilters(f) {
    const term = document.getElementById('topSearch').value.trim().toLowerCase();
    if (currentServerFilter !== "ALL" && f.serverName !== currentServerFilter) return false;
    if (term && !(f.callsign || "").toLowerCase().includes(term) && !(f.username || "").toLowerCase().includes(term)) return false;
    return true;
}

// ==========================================
// 4. CANVAS SADECE UÇAKLARI ÇİZER
// ==========================================
function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isFollowing && selectedFlightId && flights[selectedFlightId]) map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        if (isRouteMode && selectedFlightId !== f.id) return;

        f.lat += (f.targetLat - f.lat) * 0.04; f.lng += (f.targetLng - f.lng) * 0.04;

        [-360, 0, 360].forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

            // RENKLİ İRTİFA ÇİZGİSİ (SADECE SEÇİLİ UÇAKTA)
            if (selectedFlightId === f.id) {
                if (f.fullRoute && f.fullRoute.length > 0) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    let closestIdx = 0; let minD = Infinity;
                    for(let i=0; i<f.fullRoute.length; i++) { const d = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2); if(d<minD){minD=d; closestIdx=i;} }
                    let prevPos = null; let prevAlt = null;
                    for(let i=0; i<=closestIdx; i++) {
                        const wp = f.fullRoute[i]; const wpPos = map.latLngToContainerPoint([wp.lat, wp.lng + offset]);
                        if (prevPos && (prevPos.x !== wpPos.x || prevPos.y !== wpPos.y)) {
                            ctx.beginPath(); ctx.moveTo(prevPos.x, prevPos.y); ctx.lineTo(wpPos.x, wpPos.y);
                            const grad = ctx.createLinearGradient(prevPos.x, prevPos.y, wpPos.x, wpPos.y);
                            grad.addColorStop(0, getAltitudeColor(prevAlt)); grad.addColorStop(1, getAltitudeColor(wp.alt));
                            ctx.strokeStyle = grad; ctx.globalAlpha = 0.9; ctx.stroke();
                        }
                        if (wpPos.x > -50 && wpPos.x < canvas.width+50 && wpPos.y > -50 && wpPos.y < canvas.height+50) {
                            ctx.beginPath(); ctx.arc(wpPos.x, wpPos.y, 3, 0, 2*Math.PI); ctx.fillStyle = getAltitudeColor(wp.alt); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
                            if (wp.name) { ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3; ctx.fillText(wp.name, wpPos.x, wpPos.y - 8); ctx.shadowBlur = 0; }
                        }
                        prevPos = wpPos; prevAlt = wp.alt;
                    }
                    if (prevPos && (prevPos.x !== planePos.x || prevPos.y !== planePos.y)) {
                        ctx.beginPath(); ctx.moveTo(prevPos.x, prevPos.y); ctx.lineTo(planePos.x, planePos.y);
                        const finalGrad = ctx.createLinearGradient(prevPos.x, prevPos.y, planePos.x, planePos.y);
                        finalGrad.addColorStop(0, getAltitudeColor(prevAlt)); finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                        ctx.strokeStyle = finalGrad; ctx.globalAlpha = 1.0; ctx.stroke();
                    }
                } else if (f.history.length > 2) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    for (let i=1; i<f.history.length-1; i++) {
                        const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);
                        const mid1 = {x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2}; const mid2 = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
                        if (mid1.x !== mid2.x || mid1.y !== mid2.y) {
                            ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                            const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                            grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt)); grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                            ctx.strokeStyle = grad; ctx.globalAlpha = 0.8; ctx.stroke();
                        }
                    }
                    const lastP = f.history[f.history.length-1]; const prevP = f.history[f.history.length-2];
                    const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng + offset]); const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng + offset]);
                    const mid = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
                    if (mid.x !== planePos.x || mid.y !== planePos.y) {
                        ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(p2.x, p2.y, planePos.x, planePos.y);
                        const finalGrad = ctx.createLinearGradient(mid.x, mid.y, planePos.x, planePos.y);
                        finalGrad.addColorStop(0, getAltitudeColor(lastP.alt)); finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                        ctx.strokeStyle = finalGrad; ctx.globalAlpha = 1.0; ctx.stroke();
                    }
                }

                // ROTA (ROUTE) KESİK ÇİZGİ
                if (isRouteMode && f.fullRoute && f.fullRoute.length > 0) {
                    let closestIdx = 0; let minD = Infinity;
                    for(let i=0; i<f.fullRoute.length; i++) { const d = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2); if(d<minD) { minD=d; closestIdx=i; } }
                    ctx.beginPath(); ctx.setLineDash([8, 8]); ctx.lineWidth = 2.5; ctx.moveTo(planePos.x, planePos.y);
                    for(let i=closestIdx+1; i<f.fullRoute.length; i++) {
                        const wp = f.fullRoute[i]; const wpPos = map.latLngToContainerPoint([wp.lat, wp.lng + offset]);
                        ctx.lineTo(wpPos.x, wpPos.y);
                        if(wp.name && wpPos.x>-50 && wpPos.x<canvas.width+50 && wpPos.y>-50 && wpPos.y<canvas.height+50) {
                            ctx.fillStyle="#fff"; ctx.font="bold 10px Arial"; ctx.fillText(wp.name, wpPos.x, wpPos.y-8);
                        }
                    }
                    ctx.strokeStyle="#00F5D4"; ctx.globalAlpha=0.8; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1.0;
                }
            }

            ctx.save(); ctx.translate(planePos.x, planePos.y); ctx.rotate(f.heading * Math.PI / 180);
            ctx.drawImage(planeImg, -14, -14, 28, 28); ctx.restore();

            if (userLabel !== "NONE") {
                let text = "";
                if (userLabel==="CALLSIGN") text = f.callsign; if (userLabel==="USERNAME") text = f.username || ""; if (userLabel==="VA") text = f.virtualOrg || ""; if (userLabel==="LIVERY") text = f.liveryName || "";
                if (text !== "") { ctx.fillStyle = userColor; ctx.font = "bold 12px Arial"; ctx.textAlign = "center"; ctx.shadowColor = "#000"; ctx.shadowBlur = 5; ctx.fillText(text, planePos.x, planePos.y - 22); ctx.shadowBlur = 0; }
            }
        });
    });
    requestAnimationFrame(drawFlights);
}

// ==========================================
// 5. UÇAK TIKLAMA VE BİLGİ KARTI
// ==========================================
// Uçağa tıklamak için sadece harita tıklaması (ATC ve 3D Havalimanları yukarıda Leaflet Marker ile yönetiliyor)
map.on('click', function(e) {
    if (e.containerPoint.y < 60) return; 

    let clickedFlt = null; let minDistance = 50; 
    
    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        [-360, 0, 360].forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDistance) { minDistance = dist; clickedFlt = f; }
        });
    });

    if (clickedFlt) { 
        closeInfoPanel(); // Diğerlerini kapat
        selectedFlightId = clickedFlt.id; 
        
        document.getElementById('ui-callsign').innerText = clickedFlt.callsign || "Unknown";
        document.getElementById('ui-aircraft').innerText = `${clickedFlt.aircraftName || "?"} (${clickedFlt.liveryName || "Unk"})`;
        document.getElementById('ui-va').innerText = clickedFlt.virtualOrg || "General Aviation";
        document.getElementById('ui-username').innerText = clickedFlt.username || "Guest Pilot";
        document.getElementById('ui-alt').innerText = Math.round(clickedFlt.altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(clickedFlt.speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(clickedFlt.heading) + "°";
        
        document.getElementById('ui-origin').innerHTML = '<span class="loading">Loading...</span>';
        document.getElementById('ui-dest').innerHTML = '<span class="loading">Loading...</span>';
        
        fetch(`${DETAILS_API_URL}?type=flightplan&session=${clickedFlt.sessionId}&flight=${clickedFlt.id}`)
            .then(res => res.json())
            .then(data => {
                if(data.route) {
                    flights[selectedFlightId].fullRoute = data.route;
                    document.getElementById('ui-origin').innerText = data.originAirport;
                    document.getElementById('ui-dest').innerText = data.destinationAirport;
                    updateCalculatedData(flights[selectedFlightId]);
                }
            }).catch(()=>{});

        const panel = document.getElementById('flight-info-panel');
        panel.classList.remove('hidden'); panel.classList.add('active'); 
    } else {
        closeInfoPanel();
    }
});

map.on('dragstart', () => { if(isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing; const btn = document.getElementById("btn-follow");
    if(isFollowing) btn.classList.add("active-btn"); else btn.classList.remove("active-btn");
}

function toggleRoute() {
    isRouteMode = !isRouteMode; const btn = document.getElementById("btn-route");
    if(isRouteMode) { 
        btn.classList.add("active-btn"); 
        if(selectedFlightId && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            map.fitBounds([[r[0].lat, r[0].lng], [r[r.length-1].lat, r[r.length-1].lng], [flights[selectedFlightId].lat, flights[selectedFlightId].lng]], { padding: [50, 50] });
        }
        renderStaticData(); // Rota modunda ATC/Airports gizle
    } else { btn.classList.remove("active-btn"); renderStaticData(); }
}

setInterval(() => {
    if (selectedFlightId && flights[selectedFlightId]) {
        updateCalculatedData(flights[selectedFlightId]);
        document.getElementById('ui-alt').innerText = Math.round(flights[selectedFlightId].altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(flights[selectedFlightId].speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(flights[selectedFlightId].heading) + "°";
    }
}, 1000);

function updateCalculatedData(f) {
    if(!f.fullRoute || f.fullRoute.length === 0) return;
    const origin = f.fullRoute[0]; const dest = f.fullRoute[f.fullRoute.length - 1];
    const flownDist = getDistanceNM(origin.lat, origin.lng, f.lat, f.lng);
    const remainingDist = getDistanceNM(f.lat, f.lng, dest.lat, dest.lng);
    
    document.getElementById('ui-flown').innerText = Math.round(flownDist) + " nm";
    document.getElementById('ui-remaining').innerText = Math.round(remainingDist) + " nm";
    
    if (f.speed > 50) {
        const now = new Date(); const remainingHours = remainingDist / f.speed;
        document.getElementById('ui-eta').innerText = new Date(now.getTime() + remainingHours * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        document.getElementById('ui-dep-time').innerText = new Date(now.getTime() - (flownDist / f.speed) * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    let closestWpIndex = 0; let minWpDist = Infinity;
    for(let i=0; i<f.fullRoute.length; i++) { const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2); if(dist<minWpDist) { minWpDist=dist; closestWpIndex=i; } }
    const nextWp = f.fullRoute[closestWpIndex + 1] || dest;
    document.getElementById('ui-next-wp').innerText = nextWp ? nextWp.name : "N/A";
    
    let progress = (flownDist / (flownDist + remainingDist)) * 100;
    document.getElementById("ui-progress-fill").style.width = (progress > 100 ? 100 : progress) + "%";
}

function closeInfoPanel() { 
    document.querySelectorAll('.info-card').forEach(el => el.classList.remove('active'));
    setTimeout(() => { document.querySelectorAll('.info-card').forEach(el => el.classList.add('hidden')); }, 400);
    selectedFlightId = null; selectedAtcId = null; selectedAptId = null;
    if(isFollowing) toggleFollow(); if(isRouteMode) toggleRoute();
}

function applyFilters() { toggleFilterModal(false); closeInfoPanel(); }
function toggleFilterModal(forceState) { const m = document.getElementById('filter-modal'); if(m) forceState === false ? m.classList.remove('active') : m.classList.toggle('active'); }
function toggleSettingsModal() { const m = document.getElementById('settings-modal'); if(m) m.classList.toggle('active'); }

function toggleAtcModal() {
    const m = document.getElementById('atc-modal'); if(!m) return;
    if(m.classList.contains('active')) { m.classList.remove('active'); return; }
    m.classList.add('active');
    
    const container = document.getElementById('atc-list-container'); container.innerHTML = '';
    const grouped = {};
    atcData.forEach(a => { if(!grouped[a.airportName]) grouped[a.airportName] = []; grouped[a.airportName].push(a.type); });
    const typesMap = { 7:"ATIS", 0:"GND", 1:"TWR", 4:"APP", 5:"DEP", 6:"CTR" };
    
    Object.keys(grouped).forEach(apt => {
        let badgesHtml = '';
        Object.keys(typesMap).forEach(typeId => {
            const isActive = grouped[apt].includes(parseInt(typeId));
            badgesHtml += `<div class="atc-fac-box"><span class="atc-fac-label">${typesMap[typeId]}</span><div class="atc-dot ${isActive ? 'active' : ''}"></div></div>`;
        });
        container.innerHTML += `<div class="atc-list-item"><div class="atc-apt-name">${apt}</div><div class="atc-facilities">${badgesHtml}</div></div>`;
    });
}
