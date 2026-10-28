const API_URL = "https://orbtlive.vercel.app/api/flights"; 

let flightsData = []; let atcData = [];
let activeTab = "expert"; let sortCol = "callsign"; let sortAsc = true;
let currentSelectedFlight = null; let searchTimeout = null;

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.result) flightsData = data.result;
        if (data.atc) atcData = data.atc;
        
        // EKRANI ANINDA YÜKLE
        updateAtcBadges(); 
        updateTrendingWidget(); 
        renderActiveTab();

        // EKRAN YÜKLENDİKTEN SONRA TRENDLERİ ARKA PLANDA ÇEK (SİTE DONMAZ)
        fillTrendsInBackground();

    } catch(e) { console.error("Fetch Error:", e); }
}

async function fillTrendsInBackground() {
    // Sadece henüz rotası çekilmemiş 15 uçağı bulur
    const missingRoutes = flightsData.filter(f => f.originAirport === "Loading").slice(0, 15);
    if (missingRoutes.length === 0) return; // Eksik yoksa işlemi bitir
    
    const payload = missingRoutes.map(f => ({ sessionId: f.sessionId, flightId: f.flightId }));
    
    try {
        const res = await fetch(`${API_URL}?action=batch_routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const updates = await res.json();
        
        // Gelen verileri listeye ekle ve trendleri yenile
        updates.forEach(u => {
            const flt = flightsData.find(f => f.flightId === u.flightId);
            if (flt) {
                flt.originAirport = u.origin;
                flt.destinationAirport = u.dest;
            }
        });
        updateTrendingWidget(); 
    } catch (e) { console.error("Trend update failed", e); }
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

// ---------------- YENİ: AI PLANNER ALGORİTMASI ----------------
// --- 1. CORS KORUMALI VE İKONLU AI ALGORİTMASI ---
async function generateFlightBriefing() {
    const resultsDiv = document.getElementById("planner-results");
    resultsDiv.innerHTML = `<div style='text-align:center; padding:20px; color:var(--neon-cyan); display:flex; justify-content:center; align-items:center; gap:8px;'>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Analyzing ATC frequencies and satellite weather data...</div>`;

    let activeAirports = [...new Set(atcData.filter(a => a.type !== 6 && a.airportName && a.airportName.length === 4).map(a => a.airportName))];
    if (activeAirports.length < 2) {
        resultsDiv.innerHTML = "<div style='color:#FF3366; text-align:center;'>Not enough active ATCs right now to generate a fully staffed route.</div>";
        return;
    }

    activeAirports.sort(() => 0.5 - Math.random());
    let dep = activeAirports[0]; let arr = activeAirports[1];

    let depMetar = "Fetching real-time weather...", arrMetar = "Fetching real-time weather...";
    try {
        // YENİ: NOAA'yı kendi güvenli Vercel sunucumuz üzerinden çekiyoruz
        const res = await fetch(`${API_URL}?action=metar&icao=${dep},${arr}`);
        const data = await res.json();
        if (data && data.length > 0) {
            data.forEach(m => {
                if (m.icaoId === dep) depMetar = m.rawOb;
                if (m.icaoId === arr) arrMetar = m.rawOb;
            });
        }
    } catch (e) { console.error("Weather API Error", e); }

    resultsDiv.innerHTML = `
        <div style="background:rgba(255,255,255,0.05); padding:20px; border-left:4px solid var(--neon-cyan); border-radius:8px;">
            <h3 style="margin-top:0; color:var(--neon-pink); font-size:22px; display:flex; align-items:center; gap:8px;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                Recommended Route: ${dep} - ${arr}
            </h3>
            <p style="color:#ccc; font-size:13px;">Both airports currently have active ATC controllers on duty.</p>
            
            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:5px; margin-top:15px; border:1px solid rgba(0,255,0,0.2);">
                <strong style="color:#00FF00; display:flex; align-items:center; gap:5px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 13.5l-9.1-4.6L9 2 7.3 2.8l3.2 6.4-5 1-2.4-2L1 9.5l3.2 5.5.3 1H22v-2.5z"/></svg> Departure Weather (${dep}):
                </strong>
                <div style="font-family:monospace; color:#aaa; margin-top:8px; line-height:1.4;">${depMetar}</div>
            </div>
            
            <div style="background:rgba(0,0,0,0.4); padding:12px; border-radius:5px; margin-top:10px; border:1px solid rgba(0,245,212,0.2);">
                <strong style="color:var(--neon-cyan); display:flex; align-items:center; gap:5px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.5l-9.1-4.6L9 5 7.3 5.8l3.2 6.4-5 1-2.4-2L1 12.5l3.2 5.5.3 1H22v-2.5z" transform="matrix(1 0 0 -1 0 24)"/></svg> Arrival Weather (${arr}):
                </strong>
                <div style="font-family:monospace; color:#aaa; margin-top:8px; line-height:1.4;">${arrMetar}</div>
            </div>
        </div>
    `;
}

// --- 2. CORS KORUMALI VE İKONLU ATIS/METAR BUTONU ---
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
            // YENİ: NOAA'yı kendi güvenli Vercel sunucumuz üzerinden çekiyoruz
            const metarRes = await fetch(`${API_URL}?action=metar&icao=${icao}`);
            const metarData = await metarRes.json();
            if(metarData && metarData.length > 0 && metarData[0].rawOb) {
                metarText = metarData[0].rawOb;
            }
        } catch(e) { console.error("METAR failed:", e); }

        infoBox.innerHTML = `
            <div style="margin-bottom:8px;">
                <strong style="color:var(--neon-cyan); display:flex; align-items:center; gap:4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v9"/></svg> IF ATIS:
                </strong><br>${atisText}
            </div>
            <div style="border-top:1px dashed rgba(255,255,255,0.2); padding-top:8px;">
                <strong style="color:#00FF00; display:flex; align-items:center; gap:4px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19C19.985 19 22 16.985 22 14.5 22 12.164 20.22 10.246 17.935 10.029 17.158 6.549 14.07 4 10.5 4 6.358 4 3 7.358 3 11.5 3 11.758 3.013 12.012 3.039 12.26 1.34 13.064 0 14.86 0 17 0 19.761 2.239 22 5 22H17.5z"/></svg> REAL METAR:
                </strong><br>${metarText}
            </div>
        `;
        btn.style.display = "none"; 
    } catch(e) {
        infoBox.innerHTML = "Error loading aviation data.";
        btn.innerText = "Try Again";
    }
}

function updateTrendingWidget() {
    const srvFilter = document.getElementById("trendServer").value;
    const acCounts = {};
    const depCounts = {};
    const arrCounts = {};

    flightsData.forEach(f => {
        if (srvFilter !== "ALL" && !(f.serverName || "").toLowerCase().includes(srvFilter)) return;
        
        const ac = f.aircraftName;
        if (ac && ac !== "Unknown Aircraft") acCounts[ac] = (acCounts[ac] || 0) + 1;
        
        const dep = f.originAirport;
        if (dep && dep !== "N/A" && dep !== "Loading" && dep.length > 2) depCounts[dep] = (depCounts[dep] || 0) + 1;

        const arr = f.destinationAirport;
        if (arr && arr !== "N/A" && arr !== "Loading" && arr.length > 2) arrCounts[arr] = (arrCounts[arr] || 0) + 1;
    });

    const topAc = Object.entries(acCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
    const topDep = Object.entries(depCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);
    const topArr = Object.entries(arrCounts).sort((a,b) => b[1] - a[1]).slice(0, 4);

    document.getElementById("trend-aircraft").innerHTML = topAc.map(item => `<li><span>${item[0]}</span><span class="val">${item[1]}</span></li>`).join("") || "<li>No data</li>";
    document.getElementById("trend-dep").innerHTML = topDep.map(item => `<li><span>🛫 ${item[0]}</span><span class="val" style="color:#00FF00;">${item[1]} Departing</span></li>`).join("") || "<li>Loading...</li>";
    document.getElementById("trend-arr").innerHTML = topArr.map(item => `<li><span>🛬 ${item[0]}</span><span class="val" style="color:var(--neon-pink);">${item[1]} Arriving</span></li>`).join("") || "<li>Loading...</li>";
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
        tr.innerHTML = `<td style="font-weight:bold; color:var(--neon-cyan);">${f.callsign}</td><td>${f.username}</td><td>${f.aircraftName}</td><td>${f.liveryName}</td><td><span style="background:rgba(255,255,255,0.1); padding:3px 8px; border-radius:12px; font-size:11px;">${f.virtualOrganization || "-"}</span></td><td>${Math.round(f.speed)}</td><td>${Math.round(f.altitude)}</td>`;
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

async function loadAtisMetar(sessionId, icao) {
    const btn = document.getElementById(`btn-atis-${icao}`);
    const infoBox = document.getElementById(`info-${icao}`);
    btn.innerText = "Fetching Data...";
    infoBox.style.display = "block";
    infoBox.innerHTML = "Connecting to satellites... 📡";

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
        } catch(e) { console.error("METAR failed:", e); }

        infoBox.innerHTML = `
            <div style="margin-bottom:8px;"><strong style="color:var(--neon-cyan);">📡 IF ATIS:</strong><br>${atisText}</div>
            <div style="border-top:1px dashed rgba(255,255,255,0.2); padding-top:8px;"><strong style="color:#00FF00;">☁️ REAL METAR:</strong><br>${metarText}</div>
        `;
        btn.style.display = "none"; 
    } catch(e) {
        infoBox.innerHTML = "Error loading aviation data.";
        btn.innerText = "Try Again";
    }
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

// ---------------- PANEL KONTROLLERİ ----------------
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
    document.getElementById("pc-alt").innerText = `${Math.round(f.altitude)} ft`;
    document.getElementById("pc-spd").innerText = `${Math.round(f.speed)} kts`;
    document.getElementById("pc-srv").innerText = f.serverName || "Unknown Server";

    document.getElementById("live-stats-container").classList.add("hidden");
    const btnStats = document.getElementById("btn-load-stats");
    btnStats.innerText = "Load Live Stats"; btnStats.disabled = false;

    document.getElementById("active-flight-route").classList.add("hidden");
    document.getElementById("waypoints-container").classList.remove("open");
    
    fetch(`${API_URL}?action=route&sessionId=${f.sessionId}&flightId=${f.flightId}`)
        .then(res => res.json())
        .then(data => {
            if (data.route && data.route.length > 0) {
                document.getElementById("active-flight-route").classList.remove("hidden");
                document.getElementById("pc-origin").innerText = data.originAirport || "N/A";
                document.getElementById("pc-dest").innerText = data.destinationAirport || "N/A";
                document.getElementById("pc-waypoints-list").innerHTML = data.route.map(wp => `<li class="wp-item"><span class="wp-icon">◆</span> <span>${wp.name}</span></li>`).join("");
            }
        }).catch(err => console.error(err));

    openPanel("pilot-side-panel");
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
    try {
        const res = await fetch(`${API_URL}?action=stats&username=${username}`);
        const data = await res.json();
        if (data.result && data.result.length > 0) {
            const stats = data.result[0];
            document.getElementById("prof-va").innerText = stats.virtualOrganization || "No Virtual Organization";
            document.getElementById("prof-grade").innerText = stats.grade || "-";
            document.getElementById("prof-time").innerText = `${Math.round((stats.flightTime || 0) / 60)} hrs`;
            document.getElementById("prof-landings").innerText = stats.landingCount || 0;
            document.getElementById("prof-atc").innerText = stats.atcOperations || 0;
        } else { document.getElementById("prof-va").innerText = "User not found."; }
    } catch(e) { document.getElementById("prof-va").innerText = "Error fetching stats."; }
}
// ----------------------------------------------------
// YENİ: SUPABASE AUTO-PIREP (OTOMATİK UÇUŞ KAYDEDİCİ)
// ----------------------------------------------------
let myLastFlightState = null;

function checkAutoPirep(allFlights) {
    const myUsername = localStorage.getItem("if_username");
    if (!myUsername) return; // Kullanıcı giriş yapmamışsa takip etme

    // Sadece giriş yapan pilotun kendi uçağını bul
    const myFlight = allFlights.find(f => (f.username || "").toLowerCase() === myUsername.toLowerCase());
    
    if (!myFlight) {
        myLastFlightState = null; 
        return; 
    }

    // Uçak havalandıysa durumu 'airborne' (havada) olarak işaretle
    if (myFlight.altitude > 2000) {
        myLastFlightState = 'airborne';
    }
    // Uçak havadayken yere inip yavaşladıysa (Auto-PIREP Tetikleyici)
    else if (myLastFlightState === 'airborne' && myFlight.altitude < 100 && myFlight.speed < 50) {
        myLastFlightState = 'landed';
        logFlightToSupabase(myFlight); // Supabase'e gönder!
    }
}

async function logFlightToSupabase(f) {
    // Sadece rotası biliniyorsa kaydet
    if(f.originAirport === "Loading" || f.originAirport === "N/A") return; 

    const payload = {
        user_id: f.userId || "0000",
        username: f.username,
        callsign: f.callsign,
        vo_name: f.virtualOrganization,
        aircraft: f.aircraftName,
        origin: f.originAirport,
        destination: f.destinationAirport,
        flight_time: 0, // İleride geliştirilebilir
        landing_rate: 0 // İleride geliştirilebilir
    };

    try {
        await fetch(`${API_URL}?action=career`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        console.log("✅ Auto-PIREP: Flight successfully logged to Supabase!");
        
        // Eğer profil paneli açıksa logbook'u yenile
        if(!document.getElementById("profile-view").classList.contains("hidden")) {
            fetchProfileStats(payload.username);
        }
    } catch(e) { console.error("PIREP Error", e); }
}


// ----------------------------------------------------
// GÜNCELLEME: PROFİL VERİLERİNİ VE KARİYERİ ÇEKME
// ----------------------------------------------------
async function fetchProfileStats(username) {
    document.getElementById("prof-name").innerText = username;
    document.getElementById("prof-va").innerText = "Loading stats...";
    const logContainer = document.getElementById("prof-logbook");
    logContainer.innerHTML = "<div style='color:gray; text-align:center;'>Loading flight logs...</div>";

    try {
        // 1. Canlı IF İstatistiklerini Çek (Grade, Uçuş Saati vb.)
        const resStats = await fetch(`${API_URL}?action=stats&username=${username}`);
        const dataStats = await resStats.json();
        if (dataStats.result && dataStats.result.length > 0) {
            const stats = dataStats.result[0];
            document.getElementById("prof-va").innerText = stats.virtualOrganization || "No Virtual Organization";
            document.getElementById("prof-grade").innerText = stats.grade || "-";
            document.getElementById("prof-time").innerText = `${Math.round((stats.flightTime || 0) / 60)} hrs`;
            document.getElementById("prof-landings").innerText = stats.landingCount || 0;
            document.getElementById("prof-atc").innerText = stats.atcOperations || 0;
        } else { 
            document.getElementById("prof-va").innerText = "User not found on Live API."; 
        }

        // 2. Supabase Kariyer (Logbook) Verilerini Çek
        const resCareer = await fetch(`${API_URL}?action=career&username=${username}`);
        const dataCareer = await resCareer.json();
        
        if (dataCareer.result && dataCareer.result.length > 0) {
            logContainer.innerHTML = dataCareer.result.map(log => `
                <div style="background:rgba(255,255,255,0.05); padding:10px; margin-bottom:8px; border-left:3px solid var(--neon-cyan); border-radius:4px;">
                    <div style="font-weight:bold; color:var(--neon-cyan); margin-bottom:4px;">${log.origin} ✈️ ${log.destination}</div>
                    <div style="color:#aaa; display:flex; justify-content:space-between;">
                        <span>${log.aircraft}</span>
                        <span style="color:var(--neon-pink);">${log.callsign}</span>
                    </div>
                    <div style="color:gray; font-size:10px; margin-top:4px; border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px;">
                        ${new Date(log.created_at).toLocaleDateString()} - OrbitLive Auto-PIREP
                    </div>
                </div>
            `).join("");
        } else {
            logContainer.innerHTML = "<div style='color:gray; text-align:center;'>No flights logged yet. Your flights will be saved automatically upon landing.</div>";
        }

    } catch(e) { 
        document.getElementById("prof-va").innerText = "Error fetching stats."; 
        logContainer.innerHTML = "<div style='color:#FF3366; text-align:center;'>Database connection error.</div>";
    }
}
