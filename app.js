// ==========================================
// 1. AYARLAR VE HARİTA KURULUMU
// ==========================================
const API_URL = "https://orbtlive.vercel.app/api/flights";

const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 2, zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);

try { L.terminator({ fillOpacity: 0.2, color: '#000' }).addTo(map); } catch(e){} // Gece Gündüz Efekti

const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { const container = document.getElementById('map-container'); canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

let userColor = "#00F5D4"; 
let userLabel = "CALLSIGN";

// Özellik Kontrolleri (Ayarlardan Gelen)
let showATC = true;
let showAirports = true;
let showTracks = true;

const planeImg = new Image();
const atcImg = new Image();
const aptImg = new Image();

function updateSettings() {
    userColor = document.getElementById("planeColorPicker").value;
    userLabel = document.getElementById("planeLabelSelect").value;
    
    showATC = document.getElementById("toggleAtc").checked;
    showAirports = document.getElementById("toggleAirports").checked;
    showTracks = document.getElementById("toggleTracks").checked;

    const svgColor = encodeURIComponent(userColor); 
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
    atcImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23FF007F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'/%3E%3C/svg%3E`;
    aptImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238E9AAF' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cpath d='M8 12h8M12 8v8'/%3E%3C/svg%3E`;
}
updateSettings();

// ==========================================
// 2. VERCEL API'DEN VERİ ÇEKME VE İŞLEME
// ==========================================
let flights = {}; 
let atcData = [];
let airportsData = [];
let tracksData = [];
let selectedFlightId = null; 
let knownServers = [];
let isFollowing = false;
let isRouteMode = false;

async function fetchAllData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.atc) atcData = data.atc;
        if (data.airports) airportsData = data.airports;
        if (data.tracks) tracksData = data.tracks;

        if (data.result) {
            const uniqueServers = [...new Set(data.result.map(f => f.serverName || f.sessionId))];
            if (JSON.stringify(uniqueServers) !== JSON.stringify(knownServers)) {
                knownServers = uniqueServers;
                const dropdown = document.getElementById("serverDropdown");
                const currentVal = dropdown.value;
                dropdown.innerHTML = '<option value="ALL">All Servers</option>';
                knownServers.forEach(s => dropdown.innerHTML += `<option value="${s}">${s}</option>`);
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
                        if (history.length > 50) history.shift(); 
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

            Object.keys(flights).forEach(id => {
                if (!currentIds.has(id)) {
                    delete flights[id];
                    if (selectedFlightId === id) closeInfoPanel(); 
                }
            });
        }
    } catch(e) {}
}

fetchAllData();
setInterval(fetchAllData, 10000); // 10 saniyede bir yeni veri çek

// ==========================================
// 3. MATEMATİKSEL HESAPLAMALAR & FİLTRELER
// ==========================================
function getDistanceNM(lat1, lon1, lat2, lon2) {
    const R = 3440.1; 
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
    
    if (srv !== "ALL" && (f.serverName || f.sessionId) !== srv) return false;
    
    if (term) {
        const cs = (f.callsign || "").toLowerCase();
        const un = (f.username || "").toLowerCase();
        const va = (f.virtualOrg || "").toLowerCase();
        if (!cs.includes(term) && !un.includes(term) && !va.includes(term)) return false;
    }
    
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
// 4. CANVAS ÇİZİM MOTORU (UÇAKLAR, ATC, ROTARLAR)
// ==========================================
function parseOceanicWp(wpStr) {
    const match = wpStr.match(/^(\d{2})\/(\d{2})$/);
    if (match) {
        const lat = parseInt(match[1]);
        const lng = -parseInt(match[2]); 
        return {lat, lng};
    }
    return null;
}

function drawElements() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isFollowing && selectedFlightId && flights[selectedFlightId]) {
        map.panTo([flights[selectedFlightId].lat, flights[selectedFlightId].lng], { animate: false });
    }

    const currentZoom = map.getZoom();

    // 4.1. Okyanus Rotaları Çizimi
    if (showTracks && !isRouteMode && tracksData.length > 0) {
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255, 0, 127, 0.4)";
        tracksData.forEach(t => {
            if(!t.path) return;
            ctx.beginPath();
            let hasStart = false;
            t.path.forEach(wp => {
                const c = parseOceanicWp(wp);
                if(c) {
                    const pos = map.latLngToContainerPoint([c.lat, c.lng]);
                    if(!hasStart) { ctx.moveTo(pos.x, pos.y); hasStart = true; }
                    else { ctx.lineTo(pos.x, pos.y); }
                }
            });
            ctx.stroke();
        });
    }

    // 4.2. 3D Havalimanları Çizimi
    if (showAirports && !isRouteMode && airportsData.length > 0 && currentZoom > 4) {
        airportsData.forEach(ap => {
            if(!ap.has3D) return;
            const pos = map.latLngToContainerPoint([ap.latitude, ap.longitude]);
            if (pos.x < -20 || pos.x > canvas.width + 20 || pos.y < -20 || pos.y > canvas.height + 20) return;
            ctx.drawImage(aptImg, pos.x - 6, pos.y - 6, 12, 12);
        });
    }

    // 4.3. ATC Kuleleri Çizimi
    if (showATC && !isRouteMode && atcData.length > 0) {
        atcData.forEach(atc => {
            const pos = map.latLngToContainerPoint([atc.latitude, atc.longitude]);
            if (pos.x < -20 || pos.x > canvas.width + 20 || pos.y < -20 || pos.y > canvas.height + 20) return;
            
            ctx.drawImage(atcImg, pos.x - 8, pos.y - 14, 16, 16);
            if (currentZoom > 5) {
                ctx.fillStyle = "#FF007F"; ctx.font = "bold 9px Arial"; ctx.textAlign = "center";
                ctx.fillText(atc.airportName, pos.x, pos.y + 10);
            }
        });
    }

    // 4.4. Uçakların Çizimi
    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        if (isRouteMode && selectedFlightId !== f.id) return;

        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        const offsets = [-360, 0, 360];
        
        offsets.forEach(offset => {
            const planePos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            if (planePos.x < -50 || planePos.x > canvas.width + 50 || planePos.y < -50 || planePos.y > canvas.height + 50) return;

            if (selectedFlightId === f.id) {
                if (f.fullRoute && f.fullRoute.length > 0) {
                    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = 4;
                    
                    let closestWpIndex = 0; let minWpDist = Infinity;
                    for(let i = 0; i < f.fullRoute.length; i++) {
                        const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2);
                        if(dist < minWpDist) { minWpDist = dist; closestWpIndex = i; }
                    }

                    let prevPos = null; let prevAlt = null;
                    for(let i = 0; i <= closestWpIndex; i++) {
                        const wp = f.fullRoute[i];
                        const wpPos = map.latLngToContainerPoint([wp.lat, wp.lng + offset]);
                        
                        if (prevPos && (prevPos.x !== wpPos.x || prevPos.y !== wpPos.y)) {
                            ctx.beginPath(); ctx.moveTo(prevPos.x, prevPos.y); ctx.lineTo(wpPos.x, wpPos.y);
                            const grad = ctx.createLinearGradient(prevPos.x, prevPos.y, wpPos.x, wpPos.y);
                            grad.addColorStop(0, getAltitudeColor(prevAlt)); grad.addColorStop(1, getAltitudeColor(wp.alt));
                            ctx.strokeStyle = grad; ctx.globalAlpha = 0.9; ctx.stroke();
                        }

                        if (wpPos.x > -50 && wpPos.x < canvas.width + 50 && wpPos.y > -50 && wpPos.y < canvas.height + 50) {
                            ctx.beginPath(); ctx.arc(wpPos.x, wpPos.y, 3, 0, 2*Math.PI);
                            ctx.fillStyle = getAltitudeColor(wp.alt); ctx.fill();
                            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
                            
                            if (wp.name !== "") {
                                ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center";
                                ctx.shadowColor = "#000"; ctx.shadowBlur = 3; ctx.fillText(wp.name, wpPos.x, wpPos.y - 8); ctx.shadowBlur = 0;
                            }
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
                    for (let i = 1; i < f.history.length - 1; i++) {
                        const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng + offset]);
                        const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng + offset]);
                        const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng + offset]);

                        const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                        const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                        if (mid1.x !== mid2.x || mid1.y !== mid2.y) {
                            ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
                            const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                            grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt)); grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                            ctx.strokeStyle = grad; ctx.globalAlpha = 0.8; ctx.stroke();
                        }
                    }
                    const lastP = f.history[f.history.length - 1]; const prevP = f.history[f.history.length - 2];
                    const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng + offset]);
                    const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng + offset]);
                    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                    if (mid.x !== planePos.x || mid.y !== planePos.y) {
                        ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.quadraticCurveTo(p2.x, p2.y, planePos.x, planePos.y);
                        const finalGrad = ctx.createLinearGradient(mid.x, mid.y, planePos.x, planePos.y);
                        finalGrad.addColorStop(0, getAltitudeColor(lastP.alt)); finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
                        ctx.strokeStyle = finalGrad; ctx.globalAlpha = 1.0; ctx.stroke();
                    }
                }

                if (isRouteMode && f.fullRoute && f.fullRoute.length > 0) {
                    let closestWpIndex = 0; let minWpDist = Infinity;
                    for(let i = 0; i < f.fullRoute.length; i++) {
                        const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2);
                        if(dist < minWpDist) { minWpDist = dist; closestWpIndex = i; }
                    }

                    ctx.beginPath(); ctx.setLineDash([8, 8]); ctx.lineWidth = 2.5; ctx.moveTo(planePos.x, planePos.y);

                    for(let i = closestWpIndex + 1; i < f.fullRoute.length; i++) {
                        const wp = f.fullRoute[i];
                        const wpPos = map.latLngToContainerPoint([wp.lat, wp.lng + offset]);
                        ctx.lineTo(wpPos.x, wpPos.y);

                        if(wp.name && wpPos.x > -50 && wpPos.x < canvas.width + 50 && wpPos.y > -50 && wpPos.y < canvas.height + 50) {
                            ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial"; ctx.textAlign = "center";
                            ctx.shadowColor = "#000"; ctx.shadowBlur = 4; ctx.fillText(wp.name, wpPos.x, wpPos.y - 8); ctx.shadowBlur = 0;
                        }
                    }
                    ctx.strokeStyle = "#00F5D4"; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1.0;
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
                    ctx.fillStyle = userColor; ctx.font = "bold 12px Arial"; ctx.textAlign = "center";
                    ctx.shadowColor = "#000"; ctx.shadowBlur = 5; ctx.fillText(text, planePos.x, planePos.y - 22); ctx.shadowBlur = 0; 
                }
            }
        });
    });
    requestAnimationFrame(drawElements);
}
drawElements();

// ==========================================
// 5. ARAYÜZ ETKİLEŞİMLERİ & MODALLAR
// ==========================================
map.on('click', function(e) {
    if (e.containerPoint.y < 60) return; 

    let clicked = null; 
    let minDistance = 50; 
    
    Object.values(flights).forEach(f => {
        if (!matchesFilters(f)) return;
        [-360, 0, 360].forEach(offset => {
            const pos = map.latLngToContainerPoint([f.lat, f.lng + offset]);
            const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
            if (dist < minDistance) { minDistance = dist; clicked = f; }
        });
    });
    
    if (clicked) { 
        selectedFlightId = clicked.id; 
        document.getElementById('ui-alt').innerText = Math.round(clicked.altitude).toLocaleString() + " ft";
        document.getElementById('ui-speed').innerText = Math.round(clicked.speed) + " kts";
        document.getElementById('ui-heading').innerText = Math.round(clicked.heading) + "°";
        document.getElementById('ui-server').innerText = clicked.serverName;
        
        updateInfoPanel(clicked, true); 
        updateCalculatedData(clicked);
        document.getElementById('flight-info-panel').classList.add('active'); 
    } else { closeInfoPanel(); }
});

map.on('dragstart', () => { if(isFollowing) toggleFollow(); });

function toggleFollow() {
    isFollowing = !isFollowing;
    const btn = document.getElementById("btn-follow");
    if(isFollowing) { 
        btn.classList.add("active-btn"); 
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg> <span>Following</span>`; 
    } else { 
        btn.classList.remove("active-btn"); 
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg> <span>Follow</span>`; 
    }
}

function toggleRoute() {
    isRouteMode = !isRouteMode;
    const btn = document.getElementById("btn-route");
    if(isRouteMode) {
        btn.classList.add("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg> <span>Route On</span>`;
        if(selectedFlightId && flights[selectedFlightId].fullRoute && flights[selectedFlightId].fullRoute.length > 0) {
            const r = flights[selectedFlightId].fullRoute;
            const origin = [r[0].lat, r[0].lng];
            const dest = [r[r.length-1].lat, r[r.length-1].lng];
            const plane = [flights[selectedFlightId].lat, flights[selectedFlightId].lng];
            map.fitBounds([origin, dest, plane], { padding: [50, 50] });
        }
    } else {
        btn.classList.remove("active-btn");
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg> <span>Route</span>`;
    }
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
    const flownDist = getDistanceNM(origin.lat, origin.lng, f.lat, f.lng);
    const remainingDist = getDistanceNM(f.lat, f.lng, dest.lat, dest.lng);
    
    document.getElementById('ui-flown').innerText = Math.round(flownDist) + " nm";
    document.getElementById('ui-remaining').innerText = Math.round(remainingDist) + " nm";
    
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
    
    let closestWpIndex = 0; let minWpDist = Infinity;
    for(let i = 0; i < f.fullRoute.length; i++) {
        const dist = Math.pow(f.fullRoute[i].lat - f.lat, 2) + Math.pow(f.fullRoute[i].lng - f.lng, 2);
        if(dist < minWpDist) { minWpDist = dist; closestWpIndex = i; }
    }
    const nextWp = f.fullRoute[closestWpIndex + 1] || f.fullRoute[f.fullRoute.length - 1];
    document.getElementById('ui-next-wp').innerText = nextWp ? nextWp.name : "N/A";
    
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
        // Vercel Backend Flightplan endpoint eklendiğinde buradan fetch atılır
    }
}
