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
        
        // EKRANI ANINDA (0.1 Saniyede) YÜKLE
        updateAtcBadges(); 
        updateTrendingWidget(); 
        renderActiveTab();

        // SAYFA YÜKLENDİKTEN SONRA TRENDLERİ ARKA PLANDA YAVAŞÇA DOLDUR
        fillTrendsInBackground();

    } catch(e) { console.error("Fetch Error:", e); }
}

async function fillTrendsInBackground() {
    // "Loading" durumundaki uçakları bul (Her seferinde en fazla 15 tanesini işle)
    const missingRoutes = flightsData.filter(f => f.originAirport === "Loading").slice(0, 15);
    if (missingRoutes.length === 0) return; // Hepsi yüklendiyse işlemi bitir

    const payload = missingRoutes.map(f => ({ sessionId: f.sessionId, flightId: f.flightId }));
    
    try {
        const res = await fetch(`${API_URL}?action=batch_routes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const updates = await res.json();
        
        // Gelen yeni kalkış/varış noktalarını ana veriye ekle
        updates.forEach(u => {
            const flt = flightsData.find(f => f.flightId === u.flightId);
            if (flt) {
                flt.originAirport = u.origin;
                flt.destinationAirport = u.dest;
            }
        });
        
        // Sadece trendler widget'ını sessizce yenile (Tablo etkilenmez)
        updateTrendingWidget(); 
    } catch (e) { console.error("Trend update failed", e); }
}

function updateAtcBadges() {
    const exp = atcData.filter(a => (a.serverName || "").toLowerCase().includes("expert")).length;
    const trn = atcData.filter(a => (a.serverName || "").toLowerCase().includes("training")).length;
    document.getElementById("badge-expert").innerText = `${exp} ATC`;
    document.getElementById("badge-training").innerText = `${trn} ATC`;
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
    
    // BURASI DEĞİŞTİ: Artık "Flt" yerine kaç uçağın kalktığı/indiği yazıyor.
    document.getElementById("trend-dep").innerHTML = topDep.map(item => `<li><span>🛫 ${item[0]}</span><span class="val" style="color:#00FF00;">${item[1]} Departing</span></li>`).join("") || "<li>Loading...</li>";
    document.getElementById("trend-arr").innerHTML = topArr.map(item => `<li><span>🛬 ${item[0]}</span><span class="val" style="color:var(--neon-pink);">${item[1]} Arriving</span></li>`).join("") || "<li>Loading...</li>";
}

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if (tabId === 'atc') document.getElementById('tab-atc').classList.add('active');
    else if (tabId === 'leaderboard') document.getElementById('tab-leaderboard').classList.add('active');
    else document.getElementById('tab-flights').classList.add('active'); 
    renderActiveTab();
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

        let airports = {};
        let centers = [];

        atcs.forEach(a => {
            if (a.type === 6) { centers.push(a); } 
            else {
                let apt = a.airportName || "Unknown";
                if (!airports[apt]) airports[apt] = [];
                airports[apt].push(a);
            }
        });

        let html = "";

        // CENTER (FIR) LİSTESİ
        if (centers.length > 0) {
            html += `<div class="atc-group-title">📡 En-Route Centers (FIR)</div>`;
            centers.sort((a,b) => (a.airportName||"").localeCompare(b.airportName||"")).forEach(c => {
                html += `<div class="atc-item"><span style="font-weight:bold; font-size:14px;">${c.airportName || "CENTER"}</span><div style="display:flex; gap:10px; align-items:center;"><span class="atc-type t-6">CTR</span><span class="atc-user">${c.username}</span></div></div>`;
            });
        }

        // HAVALİMANLARI VE AÇILIR MENÜ (ACCORDION)
        const aptKeys = Object.keys(airports).sort();
        if (aptKeys.length > 0) {
            html += `<div class="atc-group-title" style="margin-top:20px;">🏢 Local Airports</div>`;
            aptKeys.forEach(apt => {
                const sId = airports[apt][0].sessionId;
                const safeId = apt.replace(/[^a-zA-Z0-9]/g, '-');
                
                html += `<div class="atc-airport-card">`;
                // Accordion Başlığı
                html += `<div class="atc-airport-header" onclick="toggleAtcAccordion('${safeId}')" style="cursor:pointer; transition:0.2s;">
                            <span>${apt}</span> 
                            <span style="font-size:11px; color:gray; font-weight:normal;">${airports[apt].length} Freq ▾</span>
                         </div>`;
                
                // Accordion İçeriği (Başlangıçta Gizli)
                html += `<div id="atc-acc-${safeId}" class="atc-accordion-content" style="display:none;">`;
                
                // ATIS ve METAR Butonu
                html += `<div class="atc-weather-box">
                            <button class="fetch-wx-btn" onclick="fetchWxData('${apt}', '${sId}', '${safeId}')">📡 Load ATIS & METAR Weather</button>
                            <div id="wx-data-${safeId}" style="display:none; margin-top:8px;"></div>
                         </div>`;
                
                // Frekanslar
                html += `<div class="atc-facilities">`;
                airports[apt].sort((a,b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type)).forEach(f => {
                    html += `<div class="atc-fac-row">
                                <span class="atc-type t-${f.type}">${typesMap[f.type] || "ATC"}</span>
                                <span class="atc-user">${f.username}</span>
                             </div>`;
                });
                html += `</div></div></div>`;
            });
        }
        return html;
    };

    const expContainer = document.getElementById("atc-expert-list");
    if(expContainer) expContainer.innerHTML = buildHtml("expert");
    
    const trnContainer = document.getElementById("atc-training-list");
    if(trnContainer) trnContainer.innerHTML = buildHtml("training");
}

// AÇILIR MENÜ KONTROLÜ
function toggleAtcAccordion(safeId) {
    const acc = document.getElementById(`atc-acc-${safeId}`);
    acc.style.display = (acc.style.display === "none") ? "block" : "none";
}

// METAR VE ATIS ÇEKİCİ (Tembel Yükleme)
async function fetchWxData(icao, sessionId, safeId) {
    const container = document.getElementById(`wx-data-${safeId}`);
    container.style.display = "block";
    container.innerHTML = `<span style="color:gray; font-size:11px;">Fetching aviation data...</span>`;

    let metarOutput = "METAR data currently unavailable.";
    let atisOutput = "No active ATIS for this airport.";

    try {
        // 1. NOAA'dan Gerçek Dünya METAR Verisini Çek
        const metarRes = await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`);
        const metarData = await metarRes.json();
        if (metarData && metarData.length > 0 && metarData[0].rawOb) {
            metarOutput = metarData[0].rawOb;
        }

        // 2. Vercel Backend'den Infinite Flight ATIS Verisini Çek
        const atisRes = await fetch(`${API_URL}?action=atis&sessionId=${sessionId}&airportIcao=${icao}`);
        const atisData = await atisRes.json();
        if (atisData.errorCode === 0 && atisData.result) {
            atisOutput = atisData.result;
        }
    } catch (e) {
        console.error("Weather Fetch Error:", e);
    }

    container.innerHTML = `
        <div class="metar-display"><strong>METAR:</strong><br>${metarOutput}</div>
        <div class="atis-display"><strong>ATIS:</strong><br>${atisOutput}</div>
    `;
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
    
    // Rota Bilgisi Çek
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
