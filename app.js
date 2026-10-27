const API_URL = "https://orbtlive.vercel.app/api/flights"; 
const STATS_API_URL = "https://orbtlive.vercel.app/api/stats"; 

let flightsData = [];
let atcData = [];
let activeTab = "expert";
let sortCol = "callsign";
let sortAsc = true;
let currentSelectedUserId = null; 

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.result) flightsData = data.result;
        if (data.atc) atcData = data.atc;
        
        updateAtcBadges();
        updateTrendingWidget();
        renderActiveTab();
    } catch(e) { console.error("Fetch Error:", e); }
}

fetchFlightData();
setInterval(fetchFlightData, 15000); 

function updateAtcBadges() {
    const expertCount = atcData.filter(a => (a.serverName || "").toLowerCase().includes("expert")).length;
    const trainingCount = atcData.filter(a => (a.serverName || "").toLowerCase().includes("training")).length;
    
    document.getElementById("badge-expert").innerText = `${expertCount} ATC`;
    document.getElementById("badge-training").innerText = `${trainingCount} ATC`;
}

function updateTrendingWidget() {
    const acCounts = {};
    const atcZones = {};

    flightsData.forEach(f => {
        // En Popüler Uçaklar
        const ac = f.aircraftName;
        if (ac && ac !== "Unknown Aircraft") {
            acCounts[ac] = (acCounts[ac] || 0) + 1;
        }
    });

    atcData.forEach(a => {
        // En Yoğun ATC Bölgeleri
        const apt = a.airportName;
        if (apt) {
            atcZones[apt] = (atcZones[apt] || 0) + 1;
        }
    });

    const topAc = Object.entries(acCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
    const topZones = Object.entries(atcZones).sort((a,b) => b[1] - a[1]).slice(0, 5);

    const acList = document.getElementById("trend-aircraft");
    acList.innerHTML = topAc.map(item => `<li><span>${item[0]}</span><span class="val">${item[1]}</span></li>`).join("");

    const zoneList = document.getElementById("trend-atc");
    zoneList.innerHTML = topZones.map(item => `<li><span>${item[0]}</span><span class="val" style="color:var(--neon-pink);">${item[1]} ATC</span></li>`).join("");
}

function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    event.currentTarget.classList.add('active');
    
    if (tabId === 'atc') document.getElementById('tab-atc').classList.add('active');
    else if (tabId === 'leaderboard') document.getElementById('tab-leaderboard').classList.add('active');
    else document.getElementById('tab-flights').classList.add('active'); 
    
    renderActiveTab();
}

function setSort(col) {
    if(sortCol === col) sortAsc = !sortAsc;
    else { sortCol = col; sortAsc = true; }
    renderActiveTab();
}

function renderActiveTab() {
    const searchTerm = document.getElementById("globalSearch").value.toLowerCase();
    if (activeTab === "leaderboard") renderLeaderboard();
    else if (activeTab === "atc") renderAtcTables(searchTerm);
    else renderFlightsTable(activeTab, searchTerm);
}

function renderFlightsTable(serverFilter, searchTerm) {
    let filtered = flightsData.filter(f => (f.serverName || "").toLowerCase().includes(serverFilter));
    
    if (searchTerm) {
        filtered = filtered.filter(f => 
            (f.callsign || "").toLowerCase().includes(searchTerm) ||
            (f.username || "").toLowerCase().includes(searchTerm) ||
            (f.liveryName || "").toLowerCase().includes(searchTerm) ||
            (f.aircraftName || "").toLowerCase().includes(searchTerm) ||
            (f.virtualOrganization || "").toLowerCase().includes(searchTerm)
        );
    }

    filtered.sort((a, b) => {
        let valA = (a[sortCol] || "").toString().toLowerCase();
        let valB = (b[sortCol] || "").toString().toLowerCase();
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });

    const tbody = document.getElementById("flights-tbody");
    if(!tbody) return;
    tbody.innerHTML = "";

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:gray;">No flights found.</td></tr>`;
        return;
    }
    
    filtered.forEach(f => {
        const vaDisplay = f.virtualOrganization ? f.virtualOrganization : "-";
        const tr = document.createElement('tr');
        tr.onclick = () => openPilotCard(f);
        tr.innerHTML = `
            <td style="font-weight:bold; color:var(--neon-cyan);">${f.callsign}</td>
            <td>${f.username}</td>
            <td>${f.aircraftName}</td>
            <td>${f.liveryName}</td>
            <td><span style="background:rgba(255,255,255,0.1); padding:3px 8px; border-radius:12px; font-size:11px;">${vaDisplay}</span></td>
            <td>${Math.round(f.speed)}</td>
            <td>${Math.round(f.altitude)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAtcTables(searchTerm) {
    const atcTypesMap = { 0:"GND", 1:"TWR", 2:"UNICOM", 3:"CLR", 4:"APP", 5:"DEP", 6:"CTR", 7:"ATIS" };
    
    const filterAtc = (srv) => atcData.filter(a => (a.serverName || "").toLowerCase().includes(srv) && 
        ((a.airportName || "").toLowerCase().includes(searchTerm) || (a.username || "").toLowerCase().includes(searchTerm))
    ).sort((a, b) => (a.airportName || "").localeCompare(b.airportName || ""));

    const renderTable = (data, tbodyId) => {
        const tbody = document.getElementById(tbodyId);
        if(!tbody) return;
        tbody.innerHTML = "";
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:gray;">No ATC online</td></tr>`;
            return;
        }

        data.forEach(a => {
            tbody.innerHTML += `
                <tr>
                    <td style="font-weight:bold;">${a.airportName || "CENTER"}</td>
                    <td style="color:var(--neon-pink); font-size:12px;">${atcTypesMap[a.type] || "ATC"}</td>
                    <td>${a.username || "Controller"}</td>
                </tr>
            `;
        });
    };

    renderTable(filterAtc("expert"), "atc-expert-tbody");
    renderTable(filterAtc("training"), "atc-training-tbody");
}

function renderLeaderboard() {
    const voMap = {};
    flightsData.forEach(flight => {
        const vo = flight.virtualOrganization;
        const pilot = flight.callsign;
        if (vo && vo.trim() !== "" && vo.toLowerCase() !== "unknown") {
            if (!voMap[vo]) voMap[vo] = { count: 0, pilots: new Set() };
            voMap[vo].count++;
            voMap[vo].pilots.add(pilot);
        }
    });

    const scoredVOs = Object.entries(voMap).map(([vo, stats]) => {
        const score = (stats.count * 2) + (stats.pilots.size * 3);
        return { name: vo, flights: stats.count, pilots: stats.pilots.size, score: score };
    });

    scoredVOs.sort((a, b) => b.score - a.score);

    const tbody = document.getElementById("vo-tbody");
    if(!tbody) return;
    tbody.innerHTML = "";

    if (scoredVOs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:gray;">No VA data available.</td></tr>`;
        return;
    }

    scoredVOs.forEach((entry, index) => {
        let rankStr = `${index + 1}.`;
        if (index === 0) rankStr = `<span class="medal-1">🥇 1st</span>`;
        if (index === 1) rankStr = `<span class="medal-2">🥈 2nd</span>`;
        if (index === 2) rankStr = `<span class="medal-3">🥉 3rd</span>`;
        tbody.innerHTML += `<tr><td style="font-weight:bold;">${rankStr}</td><td style="color:var(--neon-cyan); font-weight:bold;">${entry.name}</td><td>${entry.flights}</td><td>${entry.pilots}</td><td style="color:var(--neon-pink); font-weight:bold; font-size:16px;">${entry.score} Pts</td></tr>`;
    });
}

function openPilotCard(f) {
    currentSelectedUserId = f.userId; 
    
    document.getElementById("pc-callsign").innerText = f.callsign || "Unknown";
    document.getElementById("pc-va").innerText = f.virtualOrganization || "-";
    document.getElementById("pc-username").innerText = `Pilot: ${f.username || "Guest"}`;
    document.getElementById("pc-ac").innerText = f.aircraftName || "-";
    document.getElementById("pc-livery").innerText = f.liveryName || "-";
    document.getElementById("pc-alt").innerText = `${Math.round(f.altitude)} ft`;
    document.getElementById("pc-spd").innerText = `${Math.round(f.speed)} kts`;
    document.getElementById("pc-srv").innerText = f.serverName || "Unknown Server";

    // İstatistik alanını sıfırla ve gizle
    document.getElementById("live-stats-container").classList.add("hidden");
    const btn = document.getElementById("btn-load-stats");
    btn.innerText = "Load Live Stats";
    btn.disabled = false;

    document.getElementById("pilot-card-modal").classList.add("active");
}

function closePilotCard() {
    document.getElementById("pilot-card-modal").classList.remove("active");
}

function updateCardBg() {
    const c1 = document.getElementById("cardColor1").value;
    const c2 = document.getElementById("cardColor2").value;
    document.getElementById("pilot-card-export").style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
}

async function loadPilotStats() {
    if (!currentSelectedUserId) return alert("Bu uçuş için Pilot ID bulunamadı.");
    
    const btn = document.getElementById("btn-load-stats");
    btn.innerText = "Loading...";
    btn.disabled = true;

    try {
        const res = await fetch(`${STATS_API_URL}?userId=${currentSelectedUserId}`);
        const data = await res.json();
        
        if (data.result && data.result.length > 0) {
            const stats = data.result[0];
            document.getElementById("stat-grade").innerText = `Grade ${stats.grade || "-"}`;
            document.getElementById("stat-time").innerText = `${Math.round((stats.flightTime || 0) / 60)} hrs`;
            document.getElementById("stat-landings").innerText = stats.landingCount || 0;
            document.getElementById("live-stats-container").classList.remove("hidden");
            btn.innerText = "Stats Loaded!";
        } else {
            btn.innerText = "Stats Unavailable";
        }
    } catch (e) {
        console.error(e);
        btn.innerText = "Error Loading Stats";
    }
}

function downloadPilotCard() {
    const cardElement = document.getElementById("pilot-card-export");
    const callsign = document.getElementById("pc-callsign").innerText;
    html2canvas(cardElement, { backgroundColor: null, scale: 2 }).then(canvas => {
        const link = document.createElement("a");
        link.download = `OrbitLive_PilotCard_${callsign}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}
