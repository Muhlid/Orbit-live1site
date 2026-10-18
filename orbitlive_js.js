// ==========================================
// MAP INITIALIZATION
// ==========================================
const map = L.map('map', { center: [39.0, 35.0], zoom: 5, minZoom: 3, zoomControl: false });

const mapLayers = {
    "dark": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }),
    "satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
    "street": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }),
    "terrain": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 })
};

let currentMapLayer = mapLayers["dark"];
currentMapLayer.addTo(map);

function changeMapLayer() {
    const selected = document.getElementById("setting-maplayer").value;
    map.removeLayer(currentMapLayer);
    currentMapLayer = mapLayers[selected];
    currentMapLayer.addTo(map);
}

// ==========================================
// CANVAS SETUP & SETTINGS
// ==========================================
const canvas = document.getElementById('flight-canvas');
const ctx = canvas.getContext('2d');
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); resizeCanvas();

let planeColor = "#00F5D4"; 
let planeLabel = "CALLSIGN";
let planeImg = new Image();

function updateVisualSettings() {
    planeColor = document.getElementById("setting-color").value;
    planeLabel = document.getElementById("setting-label").value;
    const svgColor = encodeURIComponent(planeColor);
    // Base64 SVG of a plane
    planeImg.src = `data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${svgColor}'%3E%3Cpath d='M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z'/%3E%3C/svg%3E`;
}
updateVisualSettings();

// ==========================================
// UI PANEL MANAGEMENT
// ==========================================
function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    const isActive = panel.classList.contains('active');
    
    // Close all panels first
    document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.remove('active'));
    
    // Toggle the targeted panel
    if (!isActive) panel.classList.add('active');
}

function closeFlightCard() {
    document.getElementById('flight-info-card').classList.remove('active');
    selectedFlightId = null;
}

// ==========================================
// FILTERING SYSTEM
// ==========================================
let activeFilters = { callsign: "", username: "", server: "ALL" };

function applyFilters() {
    activeFilters.callsign = document.getElementById("filter-callsign").value.toLowerCase().trim();
    activeFilters.username = document.getElementById("filter-username").value.toLowerCase().trim();
    activeFilters.server = document.getElementById("filter-server").value;
    
    document.getElementById('search-panel').classList.remove('active');
}

// ==========================================
// SOCKET.IO & DATA MANAGEMENT
// ==========================================
let flights = {}; 
let selectedFlightId = null; 
let knownServers = [];

const socket = io("https://orbitlive-9v23ykd1.b4a.run");

socket.on('flightDataUpdate', (data) => {
    if (!data) return;
    
    if (data.servers && data.servers.length !== knownServers.length) {
        knownServers = data.servers;
        const dropdown = document.getElementById("filter-server");
        dropdown.innerHTML = '<option value="ALL">All Servers</option>';
        knownServers.forEach(s => dropdown.innerHTML += `<option value="${s}">${s}</option>`);
        dropdown.value = activeFilters.server;
    }

    const currentIds = new Set();
    data.result.forEach(f => {
        currentIds.add(f.flightId);
        if (flights[f.flightId]) {
            Object.assign(flights[f.flightId], {
                targetLat: f.latitude, targetLng: f.longitude, heading: f.heading, altitude: f.altitude, speed: f.speed
            });
            
            const history = flights[f.flightId].history;
            const lastPoint = history[history.length - 1];
            if (lastPoint.lat !== f.latitude || lastPoint.lng !== f.longitude) {
                history.push({ lat: f.latitude, lng: f.longitude, alt: f.altitude });
                if (history.length > 30) history.shift();
            }

            if (selectedFlightId === f.flightId) fillFlightCard(flights[f.flightId], false);
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
            if (selectedFlightId === id) closeFlightCard(); 
        }
    });
});

socket.on('flightDetailsData', (details) => {
    const elOrigin = document.getElementById('ui-origin');
    const elDest = document.getElementById('ui-dest');
    
    elOrigin.classList.remove('loading');
    elDest.classList.remove('loading');
    
    if (details) {
        elOrigin.innerText = details.originAirport;
        elDest.innerText = details.destinationAirport;
    } else {
        elOrigin.innerText = "Not Filed";
        elDest.innerText = "Not Filed";
    }
});

function fillFlightCard(f, requestDetails) {
    document.getElementById('ui-callsign').innerText = f.callsign || "Unknown";
    document.getElementById('ui-username').innerText = f.username || "Guest Pilot";
    document.getElementById('ui-va').innerText = f.virtualOrg || "None";
    document.getElementById('ui-aircraft').innerText = `${f.aircraftName || "?"} (${f.liveryName || "Unknown"})`;
    document.getElementById('ui-alt').innerText = Math.round(f.altitude).toLocaleString() + " ft";
    document.getElementById('ui-speed').innerText = Math.round(f.speed) + " kts";
    document.getElementById('ui-server').innerText = f.serverName;

    if (requestDetails) {
        const elOrigin = document.getElementById('ui-origin');
        const elDest = document.getElementById('ui-dest');
        elOrigin.innerHTML = "Fetching..."; elOrigin.classList.add('loading');
        elDest.innerHTML = "Fetching..."; elDest.classList.add('loading');
        
        socket.emit('requestFlightDetails', { sessionId: f.sessionId, flightId: f.id });
    }
}

// ==========================================
// CANVAS DRAWING & ANIMATION (Lerp & Bezier)
// ==========================================
function getAltitudeColor(alt) {
    if (alt < 10000) return '#FF007F'; 
    if (alt < 20000) return '#FFaa00'; 
    if (alt < 30000) return '#00F5D4'; 
    return '#00bbff';                  
}

function drawFlights() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    Object.values(flights).forEach(f => {
        if (activeFilters.server !== "ALL" && f.serverName !== activeFilters.server) return;
        if (activeFilters.callsign && !(f.callsign || "").toLowerCase().includes(activeFilters.callsign)) return;
        if (activeFilters.username && !(f.username || "").toLowerCase().includes(activeFilters.username)) return;

        f.lat += (f.targetLat - f.lat) * 0.04;
        f.lng += (f.targetLng - f.lng) * 0.04;

        const pos = map.latLngToContainerPoint([f.lat, f.lng]);
        if (pos.x < -100 || pos.x > canvas.width + 100 || pos.y < -100 || pos.y > canvas.height + 100) return;

        // BEZIER CURVE TRAIL WITH GRADIENT
        if (f.history.length > 2) {
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.lineWidth = 4; 

            for (let i = 1; i < f.history.length - 1; i++) {
                const p0 = map.latLngToContainerPoint([f.history[i-1].lat, f.history[i-1].lng]);
                const p1 = map.latLngToContainerPoint([f.history[i].lat, f.history[i].lng]);
                const p2 = map.latLngToContainerPoint([f.history[i+1].lat, f.history[i+1].lng]);

                const mid1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                const mid2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

                ctx.beginPath();
                ctx.moveTo(mid1.x, mid1.y);
                ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y); 

                const grad = ctx.createLinearGradient(mid1.x, mid1.y, mid2.x, mid2.y);
                grad.addColorStop(0, getAltitudeColor(f.history[i-1].alt));
                grad.addColorStop(1, getAltitudeColor(f.history[i].alt));
                
                ctx.strokeStyle = grad;
                ctx.globalAlpha = 0.8;
                ctx.stroke();
            }

            const lastP = f.history[f.history.length - 1];
            const prevP = f.history[f.history.length - 2];
            const p1 = map.latLngToContainerPoint([prevP.lat, prevP.lng]);
            const p2 = map.latLngToContainerPoint([lastP.lat, lastP.lng]);
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

            ctx.beginPath();
            ctx.moveTo(mid.x, mid.y);
            ctx.quadraticCurveTo(p2.x, p2.y, pos.x, pos.y);
            
            const finalGrad = ctx.createLinearGradient(mid.x, mid.y, pos.x, pos.y);
            finalGrad.addColorStop(0, getAltitudeColor(lastP.alt));
            finalGrad.addColorStop(1, getAltitudeColor(f.altitude));
            
            ctx.strokeStyle = finalGrad;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // DRAW AIRCRAFT
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(f.heading * Math.PI / 180);
        
        if (selectedFlightId === f.id) {
            ctx.shadowColor = "var(--accent)";
            ctx.shadowBlur = 15;
        }
        
        ctx.drawImage(planeImg, -14, -14, 28, 28);
        ctx.restore();

        // DRAW LABEL
        if (planeLabel !== "NONE") {
            let text = "";
            if (planeLabel === "CALLSIGN") text = f.callsign;
            if (planeLabel === "USERNAME") text = f.username || "";
            if (planeLabel === "VA") text = f.virtualOrg || "";
            if (planeLabel === "LIVERY") text = f.liveryName || "";
            
            if (text !== "") {
                ctx.fillStyle = planeColor;
                ctx.font = "bold 11px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.shadowColor = "#0B132B"; 
                ctx.shadowBlur = 4;
                ctx.lineWidth = 2;
                ctx.strokeText(text, pos.x, pos.y - 20); 
                ctx.fillText(text, pos.x, pos.y - 20); 
                ctx.shadowBlur = 0; 
            }
        }
    });
    requestAnimationFrame(drawFlights);
}
drawFlights();

// ==========================================
// HIT DETECTION (MAP CLICK)
// ==========================================
map.on('click', function(e) {
    if (e.containerPoint.y < 80) return; // Prevent clicking planes under top bar
    
    document.querySelectorAll('.dropdown-panel').forEach(p => p.classList.remove('active'));

    let clicked = null; let minDistance = 25;
    Object.values(flights).forEach(f => {
        if (activeFilters.server !== "ALL" && f.serverName !== activeFilters.server) return;
        if (activeFilters.callsign && !(f.callsign || "").toLowerCase().includes(activeFilters.callsign)) return;
        
        const pos = map.latLngToContainerPoint([f.lat, f.lng]);
        const dist = Math.sqrt(Math.pow(pos.x - e.containerPoint.x, 2) + Math.pow(pos.y - e.containerPoint.y, 2));
        if (dist < minDistance) { minDistance = dist; clicked = f; }
    });
    
    if (clicked) { 
        selectedFlightId = clicked.id; 
        fillFlightCard(clicked, true); 
        document.getElementById('flight-info-card').classList.add('active');
    } else {
        closeFlightCard();
    }
});