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

// ==========================================
// UÇUŞ TABLOLARI (EKSİK VERİ KORUMASI EKLENDİ)
// ==========================================
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
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:gray;">No flights found on this server.</td></tr>`;
    }
    
    filtered.forEach(f => {
        // NULL/BOŞ VERİ KORUMASI
        const cs = (f.callsign && f.callsign !== "null") ? f.callsign : "Unknown";
        const un = (f.username && f.username !== "null") ? f.username : "Guest";
        const ac = (f.aircraftName && f.aircraftName !== "null") ? f.aircraftName : "Unknown AC";
        const liv = (f.liveryName && f.liveryName !== "null") ? f.liveryName : "Default";
        const va = (f.virtualOrganization && f.virtualOrganization !== "null" && f.virtualOrganization.trim() !== "") ? f.virtualOrganization : "None";

        const tr = document.createElement('tr');
        tr.onclick = () => openPilotCard(f, cs, un, ac, liv, va);
        tr.innerHTML = `
            <td style="font-weight:bold; color:var(--neon-cyan);">${cs}</td>
            <td>${un}</td>
            <td>${ac}</td>
            <td>${liv}</td>
            <td><span style="background:rgba(255,255,255,0.1); padding:3px 8px; border-radius:12px; font-size:11px;">${va}</span></td>
            <td>${Math.round(f.speed || 0)}</td>
            <td>${Math.round(f.altitude || 0)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// ATC TABLOLARI (HAVALİMANINA GÖRE GRUPLANDIRMA VE CENTERS)
// ==========================================
function renderAtcTables(searchTerm) {
    const atcTypesMap = { 0:"GND", 1:"TWR", 2:"UNICOM", 3:"CLR", 4:"APP", 5:"DEP", 6:"CTR", 7:"ATIS" };
    
    const processAtcData = (serverName, containerId) => {
        const container = document.getElementById(containerId);
        if(!container) return;
        container.innerHTML = "";

        let serverAtc = atcData.filter(a => (a.serverName || "").toLowerCase().includes(serverName));

        if (searchTerm) {
            serverAtc = serverAtc.filter(a => 
                (a.airportName || "").toLowerCase().includes(searchTerm) || 
                (a.username || "").toLowerCase().includes(searchTerm)
            );
        }

        if (serverAtc.length === 0) {
            container.innerHTML = `<div style="text-align:center; color:gray; padding:20px;">No ATC online</div>`;
            return;
        }

        // Havalimanına Göre Gruplandır
        const grouped = {};
        serverAtc.forEach(a => {
            // Eğer tipi CTR (Center=6) ise veya havalimanı adı yoksa Centers grubuna at
            let apt = a.airportName;
            if (!apt || a.type === 6) apt = "CENTERS / FIR";
            
            if(!grouped[apt]) grouped[apt] = [];
            grouped[apt].push(a);
        });

        // Grupları Ekrana Bas (Önce Centers, Sonra A-Z Havalimanları)
        Object.keys(grouped).sort((a, b) => {
            if(a === "CENTERS / FIR") return -1;
            if(b === "CENTERS / FIR") return 1;
            return a.localeCompare(b);
        }).forEach(apt => {
            
            let rowsHtml = "";
            // Aynı havalimanındaki kontrolörleri tipe göre sırala (Örn: ATIS, CLR, GND, TWR, APP)
            grouped[apt].sort((a,b) => a.type - b.type).forEach(a => {
                rowsHtml += `
                    <div style="display:flex; justify-content:space-between; padding:10px 15px; border-bottom:1px solid rgba(255,255,255,0.05);">
                        <span style="color:var(--neon-pink); font-size:12px; font-weight:bold; width:60px;">${atcTypesMap[a.type] || "ATC"}</span>
                        <span style="color:#fff; font-size:14px; flex:1;">${a.username || "Controller"}</span>
                        <span style="color:#00FF00; font-size:10px; font-weight:bold;">🟢 ON</span>
                    </div>
                `;
            });

            const boxHtml = `
                <div style="background:var(--bg-panel); border:1px solid rgba(255,255,255,0.1); border-radius:12px; overflow:hidden;">
                    <div style="background:rgba(0,0,0,0.5); padding:12px 15px; font-weight:bold; color:var(--neon-cyan); border-bottom:1px solid rgba(255,255,255,0.1); font-size:16px;">
                        ${apt === "CENTERS / FIR" ? '🌍 ' : '✈️ '} ${apt}
                    </div>
                    <div style="display:flex; flex-direction:column;">
                        ${rowsHtml}
                    </div>
                </div>
            `;
            container.innerHTML += boxHtml;
        });
    };

    processAtcData("expert", "atc-expert-container");
    processAtcData("training", "atc-training-container");
}

// ==========================================
// VO LİDERLİK TABLOSU
// ==========================================
function renderLeaderboard() {
    const vaStats = {};

    flightsData.forEach(f => {
        const va = f.virtualOrganization;
        if (va && va !== "null" && va.trim() !== "" && va.toLowerCase() !== "none" && va.toLowerCase() !== "unknown") {
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
    if(!tbody) return;
    tbody.innerHTML = "";

    if (leaderboard.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:gray;">No VA data available.</td></tr>`;
    }

    leaderboard.forEach((vo, index) => {
        let rankStr = `${index + 1}.`;
        if (index === 0) rankStr = `<span class="medal-1">🥇 1st</span>`;
        if (index === 1) rankStr = `<span class="medal-2">🥈 2nd</span>`;
        if (index === 2) rankStr = `<span class="medal-3">🥉 3rd</span>`;

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

// ==========================================
// PİLOT KARTI VE İNDİRME MANTIĞI
// ==========================================
function openPilotCard(f, cs, un, ac, liv, va) {
    document.getElementById("pc-callsign").innerText = cs;
    document.getElementById("pc-va").innerText = va;
    document.getElementById("pc-username").innerText = `Pilot: ${un}`;
    document.getElementById("pc-ac").innerText = ac;
    document.getElementById("pc-livery").innerText = liv;
    document.getElementById("pc-alt").innerText = `${Math.round(f.altitude || 0)} ft`;
    document.getElementById("pc-spd").innerText = `${Math.round(f.speed || 0)} kts`;
    document.getElementById("pc-srv").innerText = f.serverName || "Unknown Server";

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
