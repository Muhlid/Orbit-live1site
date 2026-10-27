const API_URL = "https://orbtlive.vercel.app/api/flights"; 

let flightsData = [];
let atcData = [];
let activeTab = "expert";
let sortCol = "callsign";
let sortAsc = true;

async function fetchFlightData() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.result) flightsData = data.result;
        if (data.atc) atcData = data.atc;
        
        renderActiveTab();
    } catch(e) { console.error("Fetch Error:", e); }
}
fetchFlightData();
setInterval(fetchFlightData, 15000);

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

    if (activeTab === "leaderboard") {
        renderLeaderboard();
    } else if (activeTab === "atc") {
        renderAtcTables(searchTerm);
    } else {
        renderFlightsTable(activeTab, searchTerm);
    }
}

function renderFlightsTable(serverFilter, searchTerm) {
    const srvName = serverFilter === 'expert' ? "Expert Server" : (serverFilter === 'training' ? "Training Server" : "Casual Server");
    
    let filtered = flightsData.filter(f => f.serverName === srvName);
    
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
    tbody.innerHTML = "";
    
    filtered.forEach(f => {
        const tr = document.createElement('tr');
        tr.onclick = () => openPilotCard(f);
        tr.innerHTML = `
            <td style="font-weight:bold; color:var(--neon-cyan);">${f.callsign || "-"}</td>
            <td>${f.username || "Guest"}</td>
            <td>${f.aircraftName || "-"}</td>
            <td>${f.liveryName || "-"}</td>
            <td><span style="background:rgba(255,255,255,0.1); padding:3px 8px; border-radius:12px; font-size:11px;">${f.virtualOrganization || "N/A"}</span></td>
            <td>${Math.round(f.speed)}</td>
            <td>${Math.round(f.altitude)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAtcTables(searchTerm) {
    const atcTypesMap = { 0:"GND", 1:"TWR", 2:"UNICOM", 3:"CLR", 4:"APP", 5:"DEP", 6:"CTR", 7:"ATIS" };
    
    const filterAtc = (srv) => atcData.filter(a => a.serverName === srv && 
        ((a.airportName || "").toLowerCase().includes(searchTerm) || (a.username || "").toLowerCase().includes(searchTerm))
    ).sort((a, b) => (a.airportName || "").localeCompare(b.airportName || ""));

    const renderTable = (data, tbodyId) => {
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = "";
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

    renderTable(filterAtc("Expert Server"), "atc-expert-tbody");
    renderTable(filterAtc("Training Server"), "atc-training-tbody");
}

function renderLeaderboard() {
    const vaStats = {};

    flightsData.forEach(f => {
        const va = f.virtualOrganization;
        if (va && va.trim() !== "" && va.toLowerCase() !== "unknown" && va.toLowerCase() !== "null") {
            if (!vaStats[va]) vaStats[va] = { flights: 0, pilots: new Set() };
            vaStats[va].flights++;
            vaStats[va].pilots.add(f.username || f.callsign); 
        }
    });

    const leaderboard = Object.keys(vaStats).map(va => {
        const fltCount = vaStats[va].flights;
        const pltCount = vaStats[va].pilots.size;
        const score = (fltCount * 2) + (pltCount * 3); 
        return { name: va, flights: fltCount, pilots: pltCount, score: score };
    });

    leaderboard.sort((a, b) => b.score - a.score);

    const tbody = document.getElementById("vo-tbody");
    tbody.innerHTML = "";

    leaderboard.forEach((vo, index) => {
        let rankStr = `${index + 1}.`;
        if (index === 0) rankStr = `<span class="medal-1">🥇 1.</span>`;
        if (index === 1) rankStr = `<span class="medal-2">🥈 2.</span>`;
        if (index === 2) rankStr = `<span class="medal-3">🥉 3.</span>`;

        tbody.innerHTML += `
            <tr>
                <td style="font-weight:bold;">${rankStr}</td>
                <td style="color:var(--neon-cyan); font-weight:bold;">${vo.name}</td>
                <td>${vo.flights}</td>
                <td>${vo.pilots}</td>
                <td style="color:var(--neon-pink); font-weight:bold; font-size:16px;">${vo.score} Pts</td>
            </tr>
        `;
    });
}

function openPilotCard(f) {
    document.getElementById("pc-callsign").innerText = f.callsign || "Unknown";
    document.getElementById("pc-va").innerText = f.virtualOrganization || "GA";
    document.getElementById("pc-username").innerText = `Pilot: ${f.username || "Guest"}`;
    document.getElementById("pc-ac").innerText = f.aircraftName || "-";
    document.getElementById("pc-livery").innerText = f.liveryName || "-";
    document.getElementById("pc-alt").innerText = `${Math.round(f.altitude)} ft`;
    document.getElementById("pc-spd").innerText = `${Math.round(f.speed)} kts`;
    document.getElementById("pc-srv").innerText = f.serverName || "-";

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

function downloadPilotCard() {
    const cardElement = document.getElementById("pilot-card-export");
    const callsign = document.getElementById("pc-callsign").innerText;

    html2canvas(cardElement, { 
        backgroundColor: null, 
        scale: 2 
    }).then(canvas => {
        const link = document.createElement("a");
        link.download = `OrbitLive_PilotCard_${callsign}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}
