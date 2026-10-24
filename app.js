// ==========================================
// 1. AYARLAR VE YENİ HARİTA MODLARI
// ==========================================
const API_URL = "https://orbtlive.vercel.app/api/flights"; 
const DETAILS_API_URL = "https://orbtlive.vercel.app/api/details"; 

const mapLayers = {
    dark: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
    terrain: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
};

const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);

let currentMapLayer = mapLayers.dark;
currentMapLayer.addTo(map);

function changeMapLayer() {
    const selector = document.getElementById("mapLayerSelect");
    if(!selector) return;
    map.removeLayer(currentMapLayer);
    currentMapLayer = mapLayers[selector.value];
    currentMapLayer.addTo(map);
}

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { const container = document.getElementById('map-container'); canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

let userColor = "#00F5D4"; let userLabel = "CALLSIGN";
let showATC = true, showAirports = true, showTracks = true;

// CANAVAS RESİMLERİ (KAYMAYI ENGELLEYEN SİSTEM)
const planeImg = new Image();
const atcImg = new Image();
const aptImg = new Image();

function updateSettings() {
    const cp = document.getElementById("planeColorPicker"); if(cp) userColor = cp.value;
    const ls = document.getElementById("planeLabelSelect"); if(ls) userLabel = ls.value;
    const ta = document.getElementById("toggleAtc"); if(ta) showATC = ta.checked;
    const tap = document.getElementById("toggleAirports"); if(tap) showAirports = tap.checked;
    const tt = document.getElementById("toggleTracks"); if(tt) showTracks = tt.checked;

    const svgColor = encodeURIComponent(userColor); 
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
    atcImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FF007F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2L12 22 M8 22L16 22 M12 2A4 4 0 0 0 8 6 M12 2A4 4 0 0 1 16 6 M12 2A8 8 0 0 0 4 10 M12 2A8 8 0 0 1 20 10'/%3E%3C/svg%3E`;
    aptImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238E9AAF' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M8 12h8M12 8v8'/%3E%3C/svg%3E`;
}
updateSettings();

// ==========================================
// 2. VERCEL API VERİ ÇEKİMİ
// ==========================================
let flights = {}, atcData = [], airportsData = [], tracksData = [];
let selectedFlightId = null, selectedAtcIcao = null, selectedAptId = null;
let knownServers = [], currentServerFilter = "ALL";
let isFollowing = false, isRouteMode = false;

const atcTypesMap = { 0:"GND", 1:"TWR", 2:"UNICOM", 3:"CLR", 4:"APP", 5:"DEP", 6:"CTR", 7:"ATIS" };

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.atc) atcData = data.atc;
        if (data.airports) airportsData = data.airports;
        if (data.tracks) tracksData = data.tracks;

        if (data.result) {
            const serverCounts = {};
            data.result.forEach(f => {
                const sName = f.serverName || "Unknown Server";
                serverCounts[sName] = (serverCounts[sName] || 0) + 1;
            });
            
            const srvKeys = Object.keys(serverCounts).sort();
            if (JSON.stringify(srvKeys) !== JSON.stringify(knownServers)) { knownServers = srvKeys; }
            renderServerButtons(serverCounts);

            const currentIds = new Set();
            data.result.forEach(f => {
                currentIds.add(f.flightId);
                if (flights[f.flightId]) {
                    Object.assign(flights[f.flightId], { targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed });
                    const history = flights[f.flightId].history;
                    const lastP = history[history.length - 1];
                    if (lastP && (lastP.lat !== f.latitude || lastP.lng !== f.longitude)) { history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude }); if (history.length > 50) history.shift(); }
                } else {
                    flights[f.flightId] = {
                        id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, virtualOrg: f.virtualOrganization, serverName: f.serverName, aircraftName: f.aircraftName, liveryName: f.liveryName,
                        targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed, history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }], fullRoute: []
                    };
                }
            });

            Object.keys(flights).forEach(id => { if (!currentIds.has(id)) { delete flights[id]; if (selectedFlightId === id) closeInfoPanel(); } });
        }
    } catch(e) {}
}

fetchFlightData();
setInterval(fetchFlightData, 12000);

function renderServerButtons(counts) {
    const container = document.getElementById("server-buttons");
    if(!container) return;
    let html = `<button class="server-btn ${currentServerFilter === 'ALL' ? 'active' : ''}" onclick="setServerFilter('ALL')">All</button>`;
    const colors = { "Expert Server": "#00FF00", "Training Server": "#FFEA00", "Casual Server": "#00bbff" };

    knownServers.forEach(srv => {
        const color = colors[srv] || "#fff";
        const count = counts ? counts[srv] : 0;
        html += `<button class="server-btn ${currentServerFilter === srv ? 'active' : ''}" onclick="setServerFilter('${srv}')">
                    <div class="server-dot" style="background:${color}; width:8px; height:8px; border-radius:50%; box-shadow:0 0 8px ${color};"></div>
                    ${srv.split(' ')[0]} ${count}
                 </button>`;
    });
    container.innerHTML = html;
}

function setServerFilter(srv) { currentServerFilter = srv; fetchFlightData(); closeInfoPanel(); }

function matchesFilters(f) {
    const termEl = document.getElementById('topSearch');
    const term = termEl ? termEl.value.trim().toLowerCase() : "";
    if (currentServerFilter !== "ALL" && f.serverName !== currentServerFilter) return false;
    if (term && !(f.callsign || "").toLowerCase().includes(term) && !(f.username || "").toLowerCase().includes(term)) return false;
    return true;
}

function getAltitudeColor(alt) { if (alt <= 5000) return '#FFFFFF'; if (alt <= 10000) return '#FFEA00'; if (alt <= 20000) return '#00FF00'; if (alt <= 30000) return '#00bbff'; if (alt <= 39999) return '#A200FF'; return '#FF0000'; }

// ==========================================
// 4. MÜKEMMEL CANVAS ÇİZİM MOTORU
// ==========================================
map.on('move', drawElements);
map.on('zoom', drawElements);

function drawElements() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isFollowing && selectedFlightId && flights[selectedFlightId]) map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });
    const currentZoom = map.getZoom();

    // 3D HAVALİMANLARI (KAYMAZ CANVAS)
    if (showAirports && !isRouteMode && currentZoom > 4) {
        airportsData.forEach(ap => {
            if(!ap.has_3d && !ap.has3D) return;
            const pos = map.latLngToContainerPoint([ap.latitude, ap.longitude]);
            if (pos.x < -20 || pos.x > canvas.width + 20 || pos.y < -20 || pos.y > canvas.height + 20) return;
            ctx.drawImage(aptImg, pos.x - 8, pos.y - 8, 16, 16);
        });
    }

    // ATC KULELERİ (KAYMAZ CANVAS)
    if (showATC && !isRouteMode) {
        const uniqueAtc = [...new Map(atcData.filter(a => currentServerFilter === "ALL" || a.serverName === currentServerFilter).map(item => [item.airportName, item])).values()];
        uniqueAtc.forEach(atc => {
            const pos = map.latLngToContainerPoint([atc.latitude, atc.longitude]);
            if (pos.x < -20 || pos.x > canvas.width + 20 || pos.y < -20 || pos.y > canvas.height + 20) return;
            if (selectedAtcIcao === atc.airportName) { ctx.beginPath(); ctx.arc(pos.x, pos.y-2, 16, 0, 2*Math.PI); ctx.fillStyle="rgba(255,0,127,0.2)"; ctx.fill(); ctx.strokeStyle="#FF007F"; ctx.stroke(); }
            ctx.drawImage(atcImg, pos.x - 12, pos.y - 12, 24, 24);
            if (currentZoom > 5) { ctx.fillStyle = "#FF007F"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center"; ctx.fillText(atc.airportName, pos.x, pos.y + 20); }
        });
    }

    // UÇAKLAR
    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        if (isRouteMode && selectedFlightId !== f.id) return;
        f.lat += (f.targetLat - f.lat) * 0.04; f.lng += (f.targetLng - f.lng) * 0.04;

        [-360, 0, 360].forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

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
                } else if (f.history && f.history.length > 1) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    for (let i=1; i<f.history.length; i++) {
                        const p1 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
                        const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
                        grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt)); grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                        ctx.strokeStyle = grad; ctx.globalAlpha = 0.8; ctx.stroke();
                    }
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
    requestAnimationFrame(drawElements);
}
drawElements();

// ==========================================
// 5. MATEMATİKSEL TIKLAMA HESABI (KAPANMA SORUNU ÇÖZÜLDÜ)
// ==========================================
map.on('click', function(e) {
    if (e.containerPoint.y < 60) return; 

    let clickedFlt = null, clickedAtc = null, clickedApt = null;
    let minDFlt = 30, minDAtc = 20, minDApt = 20;

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        [-360, 0, 360].forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDFlt) { minDFlt = dist; clickedFlt = f; }
        });
    });

    if (!clickedFlt && showATC) {
        const uniqueAtc = [...new Map(atcData.filter(a => currentServerFilter === "ALL" || a.serverName === currentServerFilter).map(item => [item.airportName, item])).values()];
        uniqueAtc.forEach(a => {
            const pos = map.latLngToContainerPoint([a.latitude, a.longitude]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDAtc) { minDAtc = dist; clickedAtc = a.airportName; }
        });
    }

    if (!clickedFlt && !clickedAtc && showAirports) {
        airportsData.forEach(ap => {
            if(!ap.has_3d && !ap.has3D) return;
            const pos = map.latLngToContainerPoint([ap.latitude, ap.longitude]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDApt) { minDApt = dist; clickedApt = ap.icao; }
        });
    }

    if (clickedFlt) openFlightPanel(clickedFlt);
    else if (clickedAtc) openAtcPanel(clickedAtc);
    else if (clickedApt) openAirportPanel(clickedApt);
    else closeInfoPanel();
});

function openFlightPanel(f) {
    closeInfoPanel(true);
    selectedFlightId = f.id; 
    
    const els = { cs: document.getElementById('ui-callsign'), ac: document.getElementById('ui-aircraft'), un: document.getElementById('ui-username'), alt: document.getElementById('ui-alt'), spd: document.getElementById('ui-speed'), hdg: document.getElementById('ui-heading'), orig: document.getElementById('ui-origin'), dest: document.getElementById('ui-dest') };

    if(els.cs) els.cs.innerText = f.callsign || "Unknown";
    if(els.ac) els.ac.innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unk"})`;
    if(els.un) els.un.innerText = f.username || "Guest Pilot";
    if(els.alt) els.alt.innerText = Math.round(f.altitude).toLocaleString() + " ft";
    if(els.spd) els.spd.innerText = Math.round(f.speed) + " kts";
    if(els.hdg) els.hdg.innerText = Math.round(f.heading) + "°";
    if(els.orig) els.orig.innerHTML = '<span class="loading">...</span>';
    if(els.dest) els.dest.innerHTML = '<span class="loading">...</span>';
    
    fetch(`${DETAILS_API_URL}?type=flightplan&session=${f.sessionId}&flight=${f.id}`)
        .then(res => res.json())
        .then(data => {
            if(data.route) {
                flights[selectedFlightId].fullRoute = data.route;
                if(els.orig) els.orig.innerText = data.originAirport;
                if(els.dest) els.dest.innerText = data.destinationAirport;
                updateCalculatedData(flights[selectedFlightId]);
            }
        }).catch(()=>{});

    const p = document.getElementById('flight-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

function openAtcPanel(icao) {
    closeInfoPanel(true);
    selectedAtcIcao = icao;
    
    const activeFreqs = atcData.filter(a => a.airportName === icao && (currentServerFilter === "ALL" || a.serverName === currentServerFilter));
    if(activeFreqs.length === 0) return;

    const elIcao = document.getElementById('ui-atc-icao'); if(elIcao) elIcao.innerText = icao;
    const elAtis = document.getElementById('ui-atc-atis'); if(elAtis) elAtis.innerText = "Fetching ATIS...";
    
    const container = document.getElementById('ui-atc-controllers');
    if(container) {
        container.innerHTML = '';
        activeFreqs.forEach(f => {
            container.innerHTML += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px; border:1px solid rgba(255,0,127,0.2);">
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-size:10px; font-weight:bold; color:var(--neon-pink);">${atcTypesMap[f.type] || "ATC"}</span>
                        <span style="font-size:13px; font-weight:bold; color:#fff;">${f.username || "Controller"}</span>
                    </div>
                    <span style="font-size:10px; color:#00FF00;">🟢 Active</span>
                </div>
            `;
        });
    }

    fetch(`${DETAILS_API_URL}?type=atis&session=${activeFreqs[0].sessionId}&icao=${icao}`)
        .then(res => res.json())
        .then(data => { if(elAtis) elAtis.innerText = data.atis || "No ATIS published."; })
        .catch(()=>{ if(elAtis) elAtis.innerText = "No ATIS published."; });

    const p = document.getElementById('atc-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

function openAirportPanel(icao) {
    closeInfoPanel(true);
    selectedAptId = icao;
    const ap = airportsData.find(a => a.icao === icao);
    if(!ap) return;
    
    const elIcao = document.getElementById('ui-apt-icao'); if(elIcao) elIcao.innerText = ap.icao;
    const elName = document.getElementById('ui-apt-name'); if(elName) elName.innerText = ap.name;
    const elCity = document.getElementById('ui-apt-city'); if(elCity) elCity.innerText = ap.city || "Unknown City";
    
    let inbound = 0, outbound = 0;
    Object.values(flights).forEach(f => {
        if (f.fullRoute && f.fullRoute.length > 0) {
            if (f.fullRoute[0].name === ap.icao) outbound++;
            if (f.fullRoute[f.fullRoute.length-1].name === ap.icao) inbound++;
        }
    });
    const elIn = document.getElementById('ui-apt-inbound'); if(elIn) elIn.innerText = inbound;
    const elOut = document.getElementById('ui-apt-outbound'); if(elOut) elOut.innerText = outbound;

    const p = document.getElementById('airport-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

map.on('dragstart', () => { if(isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing; const btn = document.getElementById("btn-follow");
    if(isFollowing) btn.classList.add("active-btn"); else btn.classList.remove("active-btn");
}

function toggleRoute() {
    isRouteMode = !isRouteMode; const btn = document.getElementById("btn-route");
    if(isRouteMode) { 
        btn.classList.add("active-btn"); 
        if(selectedFlightId && flights[selectedFlightId] && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            map.fitBounds([[r[0].lat, r[0].lng], [r[r.length-1].lat, r[r.length-1].lng], [flights[selectedFlightId].lat, flights[selectedFlightId].lng]], { padding: [50, 50] });
        }
    } else { btn.classList.remove("active-btn"); }
}

setInterval(() => {
    if (selectedFlightId && flights[selectedFlightId]) {
        const f = flights[selectedFlightId];
        updateCalculatedData(f);
        const altEl = document.getElementById('ui-alt'); if(altEl) altEl.innerText = Math.round(f.altitude).toLocaleString() + " ft";
        const spdEl = document.getElementById('ui-speed'); if(spdEl) spdEl.innerText = Math.round(f.speed) + " kts";
        const hdgEl = document.getElementById('ui-heading'); if(hdgEl) hdgEl.innerText = Math.round(f.heading) + "°";
    }
}, 1000);

function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.1; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function updateCalculatedData(f) {
    const etaEl = document.getElementById('ui-eta');
    const progEl = document.getElementById("ui-progress-fill");

    if(!f.fullRoute || f.fullRoute.length === 0) {
        if(etaEl) etaEl.innerText = "---"; if(progEl) progEl.style.width = "0%"; return;
    }
    
    const origin = f.fullRoute[0]; const dest = f.fullRoute[f.fullRoute.length - 1];
    const flownDist = getDistanceNM(origin.lat, origin.lng, f.lat, f.lng);
    const remainingDist = getDistanceNM(f.lat, f.lng, dest.lat, dest.lng);
    
    if (f.speed > 50) {
        const now = new Date(); const remainingHours = remainingDist / f.speed;
        if(etaEl) etaEl.innerText = new Date(now.getTime() + remainingHours * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    let progress = (flownDist / (flownDist + remainingDist)) * 100;
    if(progEl) progEl.style.width = (progress > 100 ? 100 : progress) + "%";
}

function closeInfoPanel(instant = false) { 
    document.querySelectorAll('.info-card').forEach(el => { el.classList.remove('active'); if(instant) el.classList.add('hidden'); });
    if(!instant) setTimeout(() => { document.querySelectorAll('.info-card').forEach(el => el.classList.add('hidden')); }, 400);
    
    selectedFlightId = null; selectedAtcIcao = null; selectedAptId = null;
    if(isFollowing) toggleFollow(); if(isRouteMode) toggleRoute();
}

function applyFilters() { toggleFilterModal(false); closeInfoPanel(); }
function toggleFilterModal(forceState) { const m = document.getElementById('filter-modal'); if(m) forceState === false ? m.classList.remove('active') : m.classList.toggle('active'); }
function toggleSettingsModal() { const m = document.getElementById('settings-modal'); if(m) m.classList.toggle('active'); }

// IŞINLANMA (TELEPORT) FONKSİYONU
window.teleportToAtc = function(lat, lng, icao) {
    map.setView([parseFloat(lat), parseFloat(lng)], 13);
    toggleAtcModal(false);
    openAtcPanel(icao);
};

function toggleAtcModal(forceState) {
    const m = document.getElementById('atc-modal'); if(!m) return;
    if (forceState === false) { m.classList.remove('active'); return; }
    if(m.classList.contains('active')) { m.classList.remove('active'); return; }
    m.classList.add('active');
    
    const container = document.getElementById('atc-list-container'); container.innerHTML = '';
    const grouped = {};
    atcData.forEach(a => { 
        if (currentServerFilter !== "ALL" && a.serverName !== currentServerFilter) return;
        if(!grouped[a.airportName]) grouped[a.airportName] = { types: [], lat: a.latitude, lng: a.longitude }; 
        grouped[a.airportName].types.push(a.type); 
    });
    
    Object.keys(grouped).forEach(apt => {
        let badgesHtml = '';
        Object.keys(atcTypesMap).forEach(typeId => {
            const isActive = grouped[apt].types.includes(parseInt(typeId));
            badgesHtml += `<div class="atc-fac-box"><span class="atc-fac-label">${atcTypesMap[typeId]}</span><div class="atc-dot ${isActive ? 'active' : ''}"></div></div>`;
        });
        container.innerHTML += `
            <div class="atc-list-item" onclick="teleportToAtc('${grouped[apt].lat}', '${grouped[apt].lng}', '${apt}')">
                <div class="atc-apt-name">${apt}</div>
                <div class="atc-facilities">${badgesHtml}</div>
            </div>`;
    });
}
