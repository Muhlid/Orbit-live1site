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

// KATMANLAR
const atcLayer = L.layerGroup().addTo(map);
const aptLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);

// İKONLAR (Anchor tam ortalandı, zoomda kaymaz)
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

// ==========================================
// 2. VERCEL API VERİ ÇEKİMİ VE SUNUCULAR
// ==========================================
let flights = {}, atcData = [], airportsData = [], tracksData = [];
let selectedFlightId = null, selectedAtcId = null, selectedAptId = null;
let knownServers = [], currentServerFilter = "ALL";
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
            // Sunucu Butonları Mantığı
            const serverCounts = {};
            data.result.forEach(f => {
                const sName = f.serverName || "Unknown Server";
                serverCounts[sName] = (serverCounts[sName] || 0) + 1;
            });
            
            const srvKeys = Object.keys(serverCounts).sort(); // Alfabetik sırala (Casual, Expert, Training)
            if (JSON.stringify(srvKeys) !== JSON.stringify(knownServers)) {
                knownServers = srvKeys;
            }
            renderServerButtons(serverCounts);

            const currentIds = new Set();
            data.result.forEach(f => {
                currentIds.add(f.flightId);
                if (flights[f.flightId]) {
                    Object.assign(flights[f.flightId], { targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed });
                    const history = flights[f.flightId].history;
                    const lastP = history[history.length - 1];
                    if (lastP && (lastP.lat !== f.latitude || lastP.lng !== f.longitude)) { 
                        history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude }); 
                        if (history.length > 50) history.shift(); 
                    }
                } else {
                    flights[f.flightId] = {
                        id: f.flightId, sessionId: f.sessionId, callsign: f.callsign, username: f.username, virtualOrg: f.virtualOrganization, serverName: f.serverName, aircraftName: f.aircraftName, liveryName: f.liveryName,
                        targetLat: f.latitude, targetLng: f.longitude, lat: f.latitude, lng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed, history: [{ lat: f.latitude, lng: f.longitude, alt: f.altitude }], fullRoute: []
                    };
                }
            });

            Object.keys(flights).forEach(id => {
                if (!currentIds.has(id)) { 
                    delete flights[id]; 
                    if (selectedFlightId === id) closeInfoPanel(); 
                }
            });
        }
    } catch(e) { console.error("Fetch error:", e); }
}

fetchFlightData();
setInterval(fetchFlightData, 12000);

function renderServerButtons(counts) {
    const container = document.getElementById("server-buttons");
    if(!container) return;
    
    let html = `<button class="server-btn ${currentServerFilter === 'ALL' ? 'active' : ''}" onclick="setServerFilter('ALL')">All</button>`;
    
    const colors = { "Expert Server": "var(--server-expert)", "Training Server": "var(--server-training)", "Casual Server": "var(--server-casual)" };

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

function setServerFilter(srv) { 
    currentServerFilter = srv; 
    renderServerButtons(); 
    closeInfoPanel(); 
    renderStaticData();
}

// HATA ÇÖZÜLDÜ: getElementById null hatası engellendi
function matchesFilters(f) {
    const termEl = document.getElementById('topSearch');
    const term = termEl ? termEl.value.trim().toLowerCase() : "";
    
    if (currentServerFilter !== "ALL" && f.serverName !== currentServerFilter) return false;
    if (term && !(f.callsign || "").toLowerCase().includes(term) && !(f.username || "").toLowerCase().includes(term)) return false;
    return true;
}

// ==========================================
// 3. STATİK İKON ÇİZİMLERİ VE KAPANMA HATASI ÇÖZÜMÜ
// ==========================================
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
            if(!ap.has_3d && !ap.has3D) return;
            const marker = L.marker([ap.latitude, ap.longitude], {icon: aptLeafletIcon}).addTo(aptLayer);
            
            marker.on('click', (e) => {
                // Leaflet ikonuna tıklandığında alttaki haritaya (map.click) gitmesini engeller! Kapanma hatasının KESİN ÇÖZÜMÜ
                L.DomEvent.stopPropagation(e); 
                openAirportPanel(ap);
            });
        });
    }

    if (showATC && !isRouteMode) {
        atcData.forEach(atc => {
            if (currentServerFilter !== "ALL" && atc.serverName && atc.serverName !== currentServerFilter) return;
            const marker = L.marker([atc.latitude, atc.longitude], {icon: atcLeafletIcon}).addTo(atcLayer);
            
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e); 
                openAtcPanel(atc);
            });
        });
    }
}

// ==========================================
// 4. CANVAS UÇAK VE ROTA ÇİZİM MOTORU
// ==========================================
function getAltitudeColor(alt) {
    if (alt <= 5000) return '#FFFFFF'; if (alt <= 10000) return '#FFEA00'; if (alt <= 20000) return '#00FF00'; if (alt <= 30000) return '#00bbff'; if (alt <= 39999) return '#A200FF'; return '#FF0000'; 
}

map.on('move', drawElements);
map.on('zoom', drawElements);

function drawElements() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isFollowing && selectedFlightId && flights[selectedFlightId]) map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });

    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        if (isRouteMode && selectedFlightId !== f.id) return;

        f.lat += (f.targetLat - f.lat) * 0.04; f.lng += (f.targetLng - f.lng) * 0.04;

        [-360, 0, 360].forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

            if (selectedFlightId === f.id) {
                // 1. İRTİFA ÇİZGİSİ
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
                } else if (f.history && f.history.length > 2) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    for (let i=1; i<f.history.length-1; i++) {
                        const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);
                        const mid1 = {x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2}; const mid2 = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
                        
                        ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                        const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                        grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt)); grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                        ctx.strokeStyle = grad; ctx.globalAlpha = 0.8; ctx.stroke();
                    }
                    const lastP = f.history[f.history.length-1]; const prevP = f.history[f.history.length-2];
                    const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng + offset]); const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng + offset]);
                    const mid = {x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2};
                    ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(p2.x, p2.y, planePos.x, planePos.y);
                    const finalGrad = ctx.createLinearGradient(mid.x, mid.y, planePos.x, planePos.y);
                    finalGrad.addColorStop(0, getAltitudeColor(lastP.alt)); finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                    ctx.strokeStyle = finalGrad; ctx.globalAlpha = 1.0; ctx.stroke();
                }

                // 2. ROTA (KESİK ÇİZGİ)
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
    requestAnimationFrame(drawElements);
}
drawElements();

// ==========================================
// 5. TIKLAMA HASSASİYETİ VE PANELLER
// ==========================================
// Haritaya tıklama (SADECE uçakları seçmek veya panelleri kapatmak içindir)
map.on('click', function(e) {
    // Tıklanan şey bir Leaflet marker (ATC/Airport) ise harita tıklamasını yoksay!
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest('.custom-map-icon')) return; 
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
        openFlightPanel(clickedFlt); 
    } else {
        closeInfoPanel();
    }
});

function openFlightPanel(f) {
    closeInfoPanel(true); // Animasyonsuz gizle
    selectedFlightId = f.id; 
    
    const elCallsign = document.getElementById('ui-callsign'); if(elCallsign) elCallsign.innerText = f.callsign || "Unknown";
    const elAircraft = document.getElementById('ui-aircraft'); if(elAircraft) elAircraft.innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unk"})`;
    const elVa = document.getElementById('ui-va'); if(elVa) elVa.innerText = f.virtualOrg || "General Aviation";
    const elUser = document.getElementById('ui-username'); if(elUser) elUser.innerText = f.username || "Guest Pilot";
    const elAlt = document.getElementById('ui-alt'); if(elAlt) elAlt.innerText = Math.round(f.altitude).toLocaleString() + " ft";
    const elSpd = document.getElementById('ui-speed'); if(elSpd) elSpd.innerText = Math.round(f.speed) + " kts";
    const elHdg = document.getElementById('ui-heading'); if(elHdg) elHdg.innerText = Math.round(f.heading) + "°";
    
    const elOrig = document.getElementById('ui-origin'); if(elOrig) elOrig.innerHTML = '<span class="loading">...</span>';
    const elDest = document.getElementById('ui-dest'); if(elDest) elDest.innerHTML = '<span class="loading">...</span>';
    
    fetch(`${DETAILS_API_URL}?type=flightplan&session=${f.sessionId}&flight=${f.id}`)
        .then(res => res.json())
        .then(data => {
            if(data.route) {
                flights[selectedFlightId].fullRoute = data.route;
                if(elOrig) elOrig.innerText = data.originAirport;
                if(elDest) elDest.innerText = data.destinationAirport;
                updateCalculatedData(flights[selectedFlightId]);
            }
        }).catch(()=>{});

    const p = document.getElementById('flight-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

function openAtcPanel(atc) {
    closeInfoPanel(true);
    selectedAtcId = atc.frequencyId;
    const types = ["Ground","Tower","Unicom","Clearance","Approach","Departure","Center","ATIS"];
    const elIcao = document.getElementById('ui-atc-icao'); if(elIcao) elIcao.innerText = atc.airportName || "CENTER";
    const elType = document.getElementById('ui-atc-type'); if(elType) elType.innerText = types[atc.type] || "ATC";
    const elUser = document.getElementById('ui-atc-user'); if(elUser) elUser.innerText = `Controller: ${atc.username || "Anonymous"}`;
    const elAtis = document.getElementById('ui-atc-atis'); if(elAtis) elAtis.innerText = "Fetching ATIS...";
    
    fetch(`${DETAILS_API_URL}?type=atis&session=${atc.sessionId}&icao=${atc.airportName}`)
        .then(res => res.json())
        .then(data => { if(elAtis) elAtis.innerText = data.atis || "No ATIS available."; })
        .catch(()=>{});

    const p = document.getElementById('atc-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

function openAirportPanel(ap) {
    closeInfoPanel(true);
    selectedAptId = ap.icao;
    
    const elIcao = document.getElementById('ui-apt-icao'); if(elIcao) elIcao.innerText = ap.icao;
    const elName = document.getElementById('ui-apt-name'); if(elName) elName.innerText = ap.name;
    const elCity = document.getElementById('ui-apt-city'); if(elCity) elCity.innerText = ap.city || "Unknown City";
    const elElev = document.getElementById('ui-apt-elev'); if(elElev) elElev.innerText = ap.elevation ? ap.elevation + " ft" : "---";
    
    let inbound = 0, outbound = 0;
    Object.values(flights).forEach(f => {
        if (f.fullRoute && f.fullRoute.length > 0) {
            if (f.fullRoute[0].name === ap.icao) outbound++;
            if (f.fullRoute[f.fullRoute.length-1].name === ap.icao) inbound++;
        }
    });
    const elIn = document.getElementById('ui-apt-inbound'); if(elIn) elIn.innerText = inbound;
    const elOut = document.getElementById('ui-apt-outbound'); if(elOut) elOut.innerText = outbound;

    const freqContainer = document.getElementById('ui-apt-frequencies');
    if(freqContainer) {
        const activeFreqs = atcData.filter(a => a.airportName === ap.icao && (currentServerFilter === "ALL" || a.serverName === currentServerFilter));
        if (activeFreqs.length > 0) {
            freqContainer.innerHTML = '';
            const types = ["GND","TWR","UNICOM","CLR","APP","DEP","CTR","ATIS"];
            activeFreqs.forEach(f => {
                freqContainer.innerHTML += `<div class="freq-box"><span class="f-type">${types[f.type] || "ATC"}</span><span class="f-user">${f.username || "Controller"}</span><span class="f-time">🟢 Active</span></div>`;
            });
        } else {
            freqContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 11px; grid-column: span 2;">No active frequencies.</div>';
        }
    }

    const p = document.getElementById('airport-info-panel');
    if(p) { p.classList.remove('hidden'); setTimeout(()=> p.classList.add('active'), 10); }
}

map.on('dragstart', () => { if(isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing; const btn = document.getElementById("btn-follow"); if(!btn) return;
    if(isFollowing) btn.classList.add("active-btn"); else btn.classList.remove("active-btn");
}

function toggleRoute() {
    isRouteMode = !isRouteMode; const btn = document.getElementById("btn-route"); if(!btn) return;
    if(isRouteMode) { 
        btn.classList.add("active-btn"); 
        if(selectedFlightId && flights[selectedFlightId] && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            map.fitBounds([[r[0].lat, r[0].lng], [r[r.length-1].lat, r[r.length-1].lng], [flights[selectedFlightId].lat, flights[selectedFlightId].lng]], { padding: [50, 50] });
        }
        renderStaticData(); 
    } else { btn.classList.remove("active-btn"); renderStaticData(); }
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
    const flownEl = document.getElementById('ui-flown'); const remEl = document.getElementById('ui-remaining');
    const depEl = document.getElementById('ui-dep-time'); const etaEl = document.getElementById('ui-eta');
    const nextWpEl = document.getElementById('ui-next-wp'); const progEl = document.getElementById("ui-progress-fill");

    if(!f.fullRoute || f.fullRoute.length === 0) {
        if(flownEl) flownEl.innerText = "--- nm"; if(remEl) remEl.innerText = "--- nm";
        if(depEl) depEl.innerText = "---"; if(etaEl) etaEl.innerText = "---";
        if(nextWpEl) nextWpEl.innerText = "---"; if(progEl) progEl.style.width = "0%";
        return;
    }
    
    const origin = f.fullRoute[0]; const dest = f.fullRoute[f.fullRoute.length - 1];
    const flownDist = getDistanceNM(origin.lat, origin.lng, f.lat, f.lng);
    const remainingDist = getDistanceNM(f.lat, f.lng, dest.lat, dest.lng);
    
    if(flownEl) flownEl.innerText = Math.round(flownDist) + " nm";
    if(remEl) remEl.innerText = Math.round(remainingDist) + " nm";
    
    if (f.speed > 50) {
        const now = new Date(); const remainingHours = remainingDist / f.speed;
        if(etaEl) etaEl.innerText = new Date(now.getTime() + remainingHours * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        if(depEl) depEl.innerText = new Date(now.getTime() - (flownDist / f.speed) * 3600000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    let closestWpIndex = 0; let minWpDist = Infinity;
    for(let i=0; i<f.fullRoute.length; i++) { const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2); if(dist<minWpDist) { minWpDist=dist; closestWpIndex=i; } }
    const nextWp = f.fullRoute[closestWpIndex + 1] || dest;
    if(nextWpEl) nextWpEl.innerText = nextWp ? nextWp.name : "N/A";
    
    let progress = (flownDist / (flownDist + remainingDist)) * 100;
    if(progEl) progEl.style.width = (progress > 100 ? 100 : progress) + "%";
}

function closeInfoPanel(instant = false) { 
    document.querySelectorAll('.info-card').forEach(el => {
        el.classList.remove('active');
        if(instant) el.classList.add('hidden');
    });
    if(!instant) setTimeout(() => { document.querySelectorAll('.info-card').forEach(el => el.classList.add('hidden')); }, 400);
    
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
