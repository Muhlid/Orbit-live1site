const API_URL = "https://orbtlive.vercel.app/api/flights"; 

let flightsData = []; let atcData = [];
let activeTab = "expert"; let sortCol = "callsign"; let sortAsc = true;
let currentSelectedFlight = null; let searchTimeout = null;
let leafletMap = null; 

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.result) flightsData = data.result;
        if (data.atc) atcData = data.atc;
        
        updateAtcBadges(); 
        
        // KALKIŞ VE VARIŞI DOĞRUDAN UÇUŞ VERİSİNDEN BULMA (EKSİKSE N/A)
        flightsData.forEach(flight => {
             // API'den rota (waypoint) geliyorsa
             if (flight.flightPlan && flight.flightPlan.waypoints && flight.flightPlan.waypoints.length > 0) {
                 const waypoints = flight.flightPlan.waypoints;
                 flight.originAirport = waypoints[0].name || "N/A";
                 flight.destinationAirport = waypoints[waypoints.length - 1].name || "N/A";
             } 
             // Zaten önbellekten origin/destination geliyorsa
             else if (flight.origin && flight.destination) {
                 flight.originAirport = flight.origin;
                 flight.destinationAirport = flight.destination;
             }
             // Hiçbiri yoksa N/A atıyoruz ki Loading'de takılıp kalmasın
             else {
                 flight.originAirport = "N/A";
                 flight.destinationAirport = "N/A";
             }
        });

        updateTrendingWidget(); 
        renderActiveTab();
        
        if (flightsData.length > 0) checkAutoPirep(flightsData);

    } catch(e) { console.error("Fetch Error:", e); }
}

fetchFlightData();
setInterval(fetchFlightData, 15000); 

function updateAtcBadges() {
    const exp = atcData.filter(a => (a.serverName || "").toLowerCase().includes("expert")).length;
    const trn = atcData.filter(a => (a.serverName || "").toLowerCase().includes("training")).length;
    document.getElementById("badge-expert").innerText = `${exp} ATC`;
    document.getElementById("badge-training").innerText = `${trn} ATC`;
}

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    if (tabId === 'atc') document.getElementById('tab-atc').classList.add('active');
    else if (tabId === 'leaderboard') document.getElementById('tab-leaderboard').classList.add('active');
    else if (tabId === 'planner') document.getElementById('tab-planner').classList.add('active');
    else document.getElementById('tab-flights').classList.add('active'); 
    
    if(tabId !== 'planner') renderActiveTab();
}

async function generateFlightBriefing() {
    const resultsDiv = document.getElementById("planner-results");
    resultsDiv.innerHTML = `<div style='text-align:center; padding:20px; color:var(--neon-cyan);'>Analyzing ATC frequencies and satellite weather data...</div>`;

    let activeAirports = [...new Set(atcData.filter(a => a.type !== 6 && a.airportName && a.airportName.length === 4).map(a => a.airportName))];
    if (activeAirports.length < 2) {
        resultsDiv.innerHTML = "<div style='color:#FF3366; text-align:center;'>Not enough active ATCs right now to generate a route.</div>";
        return;
    }

    activeAirports.sort(() => 0.5 - Math.random());
    let dep = activeAirports[0]; let arr = activeAirports[1];

    let depMetar = "Real-time weather unavailable...", arrMetar = "Real-time weather unavailable...";
    try {
        const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${dep},${arr}&format=json`);
        const data = await res.json();
        if (data && data.length > 0) {
            data.forEach(m => {
                if (m.icaoId === dep) depMetar = m.rawOb;
                if (m.icaoId === arr) arrMetar = m.rawOb;
            });
        }
    } catch (e) {}

    resultsDiv.innerHTML = `
        <div style="background:rgba(255,255,255,0.05); padding:20px; border-left:4px solid var(--neon-cyan); border-radius:8px;">
            <h3 style="margin-top:0; color:var(--neon-pink);">Recommended Route: ${dep} - ${arr}</h3>
            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:5px; margin-top:15px; border:1px solid rgba(0,255,0,0.2);">
                <strong style="color:#00FF00;">Departure Weather (${dep}):</strong>
                <div style="font-family:monospace; color:#aaa; margin-top:8px;">${depMetar}</div>
            </div>
            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:5px; margin-top:10px; border:1px solid rgba(0,245,212,0.2);">
                <strong style="color:var(--neon-cyan);">Arrival Weather (${arr}):</strong>
                <div style="font-family:monospace; color:#aaa; margin-top:8px;">${arrMetar}</div>
            </div>
        </div>
    `;
}

async function loadAtisMetar(sessionId, icao) {
    const btn = document.getElementById(`btn-atis-${icao}`);
    const infoBox = document.getElementById(`info-${icao}`);
    btn.innerText = "Fetching Data...";
    infoBox.style.display = "block";
    infoBox.innerHTML = "Connecting...";

    try {
        const atisRes = await fetch(`${API_URL}?action=atis&sessionId=${sessionId}&icao=${icao}`);
        const atisData = await atisRes.json();
        let atisText = (atisData.errorCode === 0 && atisData.result) ? atisData.result : "No Active ATIS on this server.";

        let metarText = "Real METAR data unavailable.";
        try {
            const metarRes = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`);
            const metarData = await metarRes.json();
            if(metarData && metarData.length > 0 && metarData[0].rawOb) {
                metarText = metarData[0].rawOb;
            }
        } catch(e) {}

        infoBox.innerHTML = `
            <div style="margin-bottom:8px;"><strong style="color:var(--neon-cyan);">IF ATIS:</strong><br>${atisText}</div>
            <div style="border-top:1px dashed rgba(255,255,255,0.2); padding-top:8px;"><strong style="color:#00FF00;">REAL METAR:</strong><br>${metarText}</div>
        `;
        btn.style.display = "none"; 
    } catch(e) {
        infoBox.innerHTML = "Error loading aviation data.";
        btn.innerText = "Try Again";
    }
}

// GÜNCELLENMİŞ TREND WIDGET
function updateTrendingWidget() {
    const srvFilter = document.getElementById("trendServer").value;
    const acCounts = {};
    const depCounts = {};
    const arrCounts = {};

    flightsData.forEach(f => {
        if (srvFilter !== "ALL" && !(f.serverName || "").toLowerCase().includes(srvFilter)) return;
        
        if (f.aircraftName && f.aircraftName !== "Unknown Aircraft") {
            acCounts[f.aircraftName] = (acCounts[f.aircraftName] || 0) + 1;
        }
        
        if (f.originAirport && f.originAirport !== "N/A" && f.originAirport !== "Loading" && f.originAirport.length > 2) {
            depCounts[f.originAirport] = (depCounts[f.originAirport] || 0) + 1;
        }

        if (f.destinationAirport && f.destinationAirport !== "N/A" && f.destinationAirport !== "Loading" && f.destinationAirport.length > 2) {
            arrCounts[f.destinationAirport] = (arrCounts[f.destinationAirport] || 0) + 1;
        }
    });

    const topAc = Object.entries(acCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
    const topDep = Object.entries(depCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
    const topArr = Object.entries(arrCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);

    document.getElementById("trend-aircraft").innerHTML = topAc.length > 0 ? topAc.map(item => `<li><span>${item[0]}</span><span class="val">${item[1]}</span></li>`).join("") : "<li><span style='color:gray;'>Not enough data</span></li>";
    document.getElementById("trend-dep").innerHTML = topDep.length > 0 ? topDep.map(item => `<li><span>🛫 ${item[0]}</span><span class="val" style="color:#00FF00;">${item[1]} Dep</span></li>`).join("") : "<li><span style='color:gray;'>Not enough data</span></li>";
    document.getElementById("trend-arr").innerHTML = topArr.length > 0 ? topArr.map(item => `<li><span>🛬 ${item[0]}</span><span class="val" style="color:var(--neon-pink);">${item[1]} Arr</span></li>`).join("") : "<li><span style='color:gray;'>Not enough data</span></li>";
}

function setSort(col) { if(sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; } renderActiveTab(); }
function handleSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { renderActiveTab(); }, 300); }

function renderActiveTab() {
    const searchTerm = document.getElementById("globalSearch").value.toLowerCase();
    if (activeTab === "leaderboard") renderLeaderboard(searchTerm);
    else if (activeTab === "atc") renderAtcTables(searchTerm);
    else renderFlightsTable(activeTab, searchTerm);
}

function renderFlightsTable(serverFilter, searchTerm) {
    let filtered = flightsData.filter(f => (f.serverName || "").toLowerCase().includes(serverFilter));
    if (searchTerm) {
        filtered = filtered.filter(f => 
            (f.callsign || "").toLowerCase().includes(searchTerm) || (f.username || "").toLowerCase().includes(searchTerm) ||
            (f.liveryName || "").toLowerCase().includes(searchTerm) || (f.aircraftName || "").toLowerCase().includes(searchTerm) ||
            (f.virtualOrganization || "").toLowerCase().includes(searchTerm)
        );
    }
    filtered.sort((a, b) => {
        let valA = (a[sortCol] || "").toString().toLowerCase(); let valB = (b[sortCol] || "").toString().toLowerCase();
        if (valA < valB) return sortAsc ? -1 : 1; if (valA > valB) return sortAsc ? 1 : -1; return 0;
    });

    const tbody = document.getElementById("flights-tbody");
    if(!tbody) return;
    if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:gray;">No flights found.</td></tr>`; return; }
    
    const fragment = document.createDocumentFragment();
    filtered.forEach(f => {
        const tr = document.createElement('tr');
        tr.onclick = () => openPilotCard(f);
        tr.innerHTML = `<td style="font-weight:bold; color:var(--neon-cyan);">${f.callsign}</td><td>${f.username || "Unknown"}</td><td>${f.aircraftName}</td><td>${f.liveryName}</td><td><span style="background:rgba(255,255,255,0.1); padding:3px 8px; border-radius:12px; font-size:11px;">${f.virtualOrganization || "-"}</span></td><td>${Math.round(f.speed || 0)}</td><td>${Math.round(f.altitude || 0)}</td>`;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = ""; tbody.appendChild(fragment);
}

function renderAtcTables(searchTerm) {
    const typesMap = { 0:"GND", 1:"TWR", 2:"UNICOM", 3:"CLR", 4:"APP", 5:"DEP", 6:"CTR", 7:"ATIS" };
    const typeOrder = [7, 3, 0, 1, 5, 4]; 

    const buildHtml = (srv) => {
        let atcs = atcData.filter(a => 
            (a.serverName || "").toLowerCase().includes(srv) && 
            ((a.airportName || "").toLowerCase().includes(searchTerm) || (a.username || "").toLowerCase().includes(searchTerm))
        );

        if (atcs.length === 0) return `<div style="text-align:center; padding:20px; color:gray;">No ATC online</div>`;

        let airports = {}; let centers = [];
        atcs.forEach(a => {
            if (a.type === 6) centers.push(a);
            else {
                let apt = a.airportName || "Unknown";
                if (!airports[apt]) airports[apt] = [];
                airports[apt].push(a);
            }
        });

        let html = "";

        if (centers.length > 0) {
            html += `<div class="atc-group-title">📡 En-Route Centers (FIR)</div>`;
            centers.sort((a,b) => (a.airportName||"").localeCompare(b.airportName||"")).forEach(c => {
                html += `<div class="atc-item"><span style="font-weight:bold; font-size:14px;">${c.airportName || "CENTER"}</span><div style="display:flex; gap:10px; align-items:center;"><span class="atc-type t-6">CTR</span><span class="atc-user">${c.username}</span></div></div>`;
            });
        }

        const aptKeys = Object.keys(airports).sort();
        if (aptKeys.length > 0) {
            html += `<div class="atc-group-title" style="margin-top:20px;">🏢 Local Airports</div>`;
            aptKeys.forEach(apt => {
                const sId = airports[apt][0].sessionId; 
                
                html += `<div class="atc-airport-card">
                            <div class="atc-airport-header" onclick="toggleAtcAccordion('${apt}')" style="cursor:pointer;">
                                <span>${apt} ▾</span> 
                                <span style="font-size:11px; color:gray; font-weight:normal;">${airports[apt].length} Freq</span>
                            </div>
                            
                            <div id="acc-${apt}" class="atc-facilities" style="display:none;">
                                <div style="margin-bottom:10px;">
                                    <button id="btn-atis-${apt}" class="glass-submit-btn" style="padding:6px 12px; font-size:11px; width:100%; background:rgba(0,245,212,0.1); color:var(--neon-cyan); border:1px solid rgba(0,245,212,0.3);" onclick="loadAtisMetar('${sId}', '${apt}')">🌤️ Fetch ATIS & Real METAR</button>
                                    <div id="info-${apt}" style="margin-top:8px; font-size:11px; color:#ccc; background:rgba(0,0,0,0.5); padding:10px; border-radius:5px; display:none; line-height:1.5;"></div>
                                </div>
                `;
                
                airports[apt].sort((a,b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)).forEach(f => {
                    html += `<div class="atc-fac-row"><span class="atc-type t-${f.type}">${typesMap[f.type] || "ATC"}</span><span class="atc-user">${f.username}</span></div>`;
                });
                html += `</div></div>`;
            });
        }
        return html;
    };

    const expContainer = document.getElementById("atc-expert-list");
    if(expContainer) expContainer.innerHTML = buildHtml("expert");
    const trnContainer = document.getElementById("atc-training-list");
    if(trnContainer) trnContainer.innerHTML = buildHtml("training");
}

function toggleAtcAccordion(apt) {
    const el = document.getElementById(`acc-${apt}`);
    el.style.display = (el.style.display === "none") ? "flex" : "none";
}

function renderLeaderboard(searchTerm) {
    const voMap = {};
    flightsData.forEach(flight => {
        const vo = flight.virtualOrganization;
        if (vo && vo.trim() !== "" && vo.toLowerCase() !== "unknown") {
            if (!voMap[vo]) voMap[vo] = { count: 0, pilots: new Set() };
            voMap[vo].count++; voMap[vo].pilots.add(flight.callsign);
        }
    });
    let scoredVOs = Object.entries(voMap).map(([vo, stats]) => { return { name: vo, flights: stats.count, pilots: stats.pilots.size, score: (stats.count * 2) + (stats.pilots.size * 3) }; });
    if (searchTerm) scoredVOs = scoredVOs.filter(vo => vo.name.toLowerCase().includes(searchTerm));
    scoredVOs.sort((a, b) => b.score - a.score);

    const tbody = document.getElementById("vo-tbody");
    if(!tbody) return;
    if (scoredVOs.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:gray;">No VA found.</td></tr>`; return; }

    const fragment = document.createDocumentFragment();
    scoredVOs.forEach((entry, index) => {
        let rankStr = `${index + 1}.`;
        if (index === 0) rankStr = `<span class="medal-1">🥇 1st</span>`;
        if (index === 1) rankStr = `<span class="medal-2">🥈 2nd</span>`;
        if (index === 2) rankStr = `<span class="medal-3">🥉 3rd</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="font-weight:bold;">${rankStr}</td><td style="color:var(--neon-cyan); font-weight:bold;">${entry.name}</td><td>${entry.flights}</td><td>${entry.pilots}</td><td style="color:var(--neon-pink); font-weight:bold; font-size:16px;">${entry.score} Pts</td>`;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = ""; tbody.appendChild(fragment);
}

function openPanel(panelId) {
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(panelId).classList.add('active');
    document.getElementById("panel-overlay").classList.add('active');
}
function closeSidePanels() {
    document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('active'));
    document.getElementById("panel-overlay").classList.remove('active');
}

function openPilotCard(f) {
    currentSelectedFlight = f; 
    document.getElementById("pc-callsign").innerText = f.callsign || "Unknown";
    document.getElementById("pc-va").innerText = f.virtualOrganization || "-";
    document.getElementById("pc-username").innerText = `Pilot: ${f.username || "Guest"}`;
    document.getElementById("pc-ac").innerText = f.aircraftName || "-";
    document.getElementById("pc-livery").innerText = f.liveryName || "-";
    document.getElementById("pc-alt").innerText = `${Math.round(f.altitude || 0)} ft`;
    document.getElementById("pc-spd").innerText = `${Math.round(f.speed || 0)} kts`;
    document.getElementById("pc-srv").innerText = f.serverName || "Unknown Server";
    
    document.getElementById("pc-origin").innerText = f.originAirport || "N/A";
    document.getElementById("pc-dest").innerText = f.destinationAirport || "N/A";

    document.getElementById("live-stats-container").classList.add("hidden");
    const btnStats = document.getElementById("btn-load-stats");
    btnStats.innerText = "Load Live Stats"; btnStats.disabled = false;
    
    const btnMap = document.getElementById("btn-show-map");
    if (btnMap) {
        if (f.latitude === undefined || f.longitude === undefined || f.latitude === null || f.longitude === null) {
            btnMap.style.display = "none";
        } else {
            btnMap.style.display = "block";
        }
    }

    openPanel("pilot-side-panel");
}

function showFlightOnMap() {
    if (!currentSelectedFlight) return;
    
    const lat = parseFloat(currentSelectedFlight.latitude);
    const lon = parseFloat(currentSelectedFlight.longitude);
    
    if (isNaN(lat) || isNaN(lon)) {
        alert("Flight coordinates are currently unavailable from the server.");
        return;
    }

    const mapContainer = document.getElementById("flight-map-container");
    mapContainer.classList.remove("hidden");
    
    if (!leafletMap) {
        if(!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }

        leafletMap = L.map('flight-map').setView([lat, lon], 6);
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(leafletMap);
    } else {
        leafletMap.setView([lat, lon], 6);
    }
    
    const planeIcon = L.divIcon({
        className: 'custom-plane-icon',
        html: `<div style="transform: rotate(${currentSelectedFlight.heading || 0}deg); color: #00F5D4; font-size: 24px;">✈️</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    leafletMap.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
            leafletMap.removeLayer(layer);
        }
    });

    L.marker([lat, lon], {icon: planeIcon})
     .addTo(leafletMap)
     .bindPopup(`<b>${currentSelectedFlight.callsign}</b><br>Alt: ${Math.round(currentSelectedFlight.altitude || 0)} ft<br>Spd: ${Math.round(currentSelectedFlight.speed || 0)} kts`)
     .openPopup();
     
     setTimeout(() => { if(leafletMap) leafletMap.invalidateSize(); }, 100);
}

function closeMap() {
    document.getElementById("flight-map-container").classList.add("hidden");
}

function toggleWaypoints() { document.getElementById("waypoints-container").classList.toggle("open"); }

async function loadPilotStats() {
    if (!currentSelectedFlight || !currentSelectedFlight.userId) {
        document.getElementById("btn-load-stats").innerText = "Stats Unavailable"; return;
    }
    const btn = document.getElementById("btn-load-stats");
    btn.innerText = "Loading..."; btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}?action=stats&userId=${currentSelectedFlight.userId}`);
        const data = await res.json();
        if (data.result && data.result.length > 0) {
            const stats = data.result[0];
            document.getElementById("stat-grade").innerText = `Grade ${stats.grade || "-"}`;
            document.getElementById("stat-time").innerText = `${Math.round((stats.flightTime || 0) / 60)} hrs`;
            document.getElementById("stat-landings").innerText = stats.landingCount || 0;
            document.getElementById("live-stats-container").classList.remove("hidden");
            btn.innerText = "Stats Loaded!";
        } else { btn.innerText = "Stats Unavailable"; }
    } catch (e) { btn.innerText = "Error Loading Stats"; }
}

function updateCardBg() {
    const c1 = document.getElementById("cardColor1").value; const c2 = document.getElementById("cardColor2").value;
    document.getElementById("pilot-card-export").style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
}

function downloadPilotCard() {
    const card = document.getElementById("pilot-card-export");
    const cs = document.getElementById("pc-callsign").innerText;
    html2canvas(card, { backgroundColor: null, scale: 2 }).then(canvas => {
        const link = document.createElement("a"); link.download = `OrbitLive_${cs}.png`; link.href = canvas.toDataURL("image/png"); link.click();
    });
}

function openSettingsPanel() {
    openPanel("profile-side-panel");
    const savedUser = localStorage.getItem("if_username");
    if (savedUser) {
        document.getElementById("settings-view").classList.add("hidden");
        document.getElementById("profile-view").classList.remove("hidden");
        fetchProfileStats(savedUser);
    } else {
        document.getElementById("settings-view").classList.remove("hidden");
        document.getElementById("profile-view").classList.add("hidden");
    }
}

function openProfilePanel() { openSettingsPanel(); }

function saveProfileSettings() {
    const input = document.getElementById("ifUsernameInput").value.trim();
    if(input) { localStorage.setItem("if_username", input); openSettingsPanel(); }
}

function logoutProfile() { localStorage.removeItem("if_username"); openSettingsPanel(); }

async function fetchProfileStats(username) {
    document.getElementById("prof-name").innerText = username;
    document.getElementById("prof-va").innerText = "Loading stats...";
    const logContainer = document.getElementById("prof-logbook");
    logContainer.innerHTML = "<div style='color:gray; text-align:center;'>Loading flight logs...</div>";

    try {
        const resStats = await fetch(`${API_URL}?action=stats&username=${username}`);
        const dataStats = await resStats.json();
        if (dataStats.result && dataStats.result.length > 0) {
            const stats = dataStats.result[0];
            document.getElementById("prof-va").innerText = stats.virtualOrganization || "No Virtual Organization";
            document.getElementById("prof-grade").innerText = stats.grade || "-";
            document.getElementById("prof-time").innerText = `${Math.round((stats.flightTime || 0) / 60)} hrs`;
            document.getElementById("prof-landings").innerText = stats.landingCount || 0;
            document.getElementById("prof-atc").innerText = stats.atcOperations || 0;
        } else { document.getElementById("prof-va").innerText = "User not found on Live API."; }

        const resCareer = await fetch(`${API_URL}?action=career&username=${username}`);
        const dataCareer = await resCareer.json();
        
        if (dataCareer.result && dataCareer.result.length > 0) {
            logContainer.innerHTML = dataCareer.result.map(log => `
                <div style="background:rgba(255,255,255,0.05); padding:10px; margin-bottom:8px; border-left:3px solid var(--neon-cyan); border-radius:4px;">
                    <div style="font-weight:bold; color:var(--neon-cyan); margin-bottom:4px; font-size:14px;">${log.origin} ✈️ ${log.destination}</div>
                    <div style="color:#aaa; display:flex; justify-content:space-between;">
                        <span>${log.aircraft}</span>
                        <span style="color:var(--neon-pink); font-weight:bold;">${log.callsign}</span>
                    </div>
                    <div style="color:gray; font-size:10px; margin-top:6px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px;">
                        ${new Date(log.created_at).toLocaleDateString()} - OrbitLive Auto-PIREP
                    </div>
                </div>
            `).join("");
        } else {
            logContainer.innerHTML = "<div style='color:gray; text-align:center;'>No flights logged yet. Complete a flight to see it here!</div>";
        }
    } catch(e) { 
        document.getElementById("prof-va").innerText = "Error fetching stats."; 
        logContainer.innerHTML = "<div style='color:#FF3366; text-align:center;'>Database connection error.</div>";
    }
}

let myLastFlightState = null;

function checkAutoPirep(allFlights) {
    const myUsername = localStorage.getItem("if_username");
    if (!myUsername) return; 

    const myFlight = allFlights.find(f => (f.username || "").toLowerCase() === myUsername.toLowerCase());
    
    if (!myFlight) {
        myLastFlightState = null; 
        return; 
    }

    if (myFlight.altitude > 2000) {
        myLastFlightState = 'airborne';
    }
    else if (myLastFlightState === 'airborne' && myFlight.altitude < 100 && myFlight.speed < 50) {
        myLastFlightState = 'landed';
        logFlightToSupabase(myFlight); 
    }
}

async function logFlightToSupabase(f) {
    if(f.originAirport === "Loading" || f.originAirport === "N/A") return; 

    const payload = {
        user_id: f.userId || "0000",
        username: f.username,
        callsign: f.callsign,
        vo_name: f.virtualOrganization,
        aircraft: f.aircraftName,
        origin: f.originAirport,
        destination: f.destinationAirport,
        flight_time: 0, 
        landing_rate: 0 
    };

    try {
        await fetch(`${API_URL}?action=career`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if(!document.getElementById("profile-view").classList.contains("hidden")) {
            fetchProfileStats(payload.username);
        }
    } catch(e) { console.error("PIREP Error", e); }
}
