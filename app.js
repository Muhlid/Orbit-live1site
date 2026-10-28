// ==========================================
// ORBITLIVE - KURŞUN GEÇİRMEZ MASTER CACHE
// ==========================================
let flightPlanCache = new Map();
let masterCache = { flights: [], atc: [], lastFetch: 0, isUpdating: false };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }

    try {
        const IF_API_KEY = process.env.IF_API_KEY;
        if (!IF_API_KEY) return res.status(500).json({ error: "Missing IF_API_KEY" });

        let query = req.query;
        if (!query) {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            query = Object.fromEntries(url.searchParams);
        }
        const { action, userId, username, sessionId, flightId, airportIcao, icao } = query;
        const headers = { 'Authorization': `Bearer ${IF_API_KEY}`, 'Content-Type': 'application/json' };

        // ----------------------------------------------------
        // MODÜL 1: ARKA PLAN ROTA DOLDURUCU (Trendler İçin)
        // ----------------------------------------------------
        if (req.method === 'POST' && action === "batch_routes") {
            let flightsToFetch = req.body ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) : [];
            let results = [];
            
            await Promise.all(flightsToFetch.map(async (f) => {
                if (flightPlanCache.has(f.flightId)) {
                    results.push({ flightId: f.flightId, ...flightPlanCache.get(f.flightId) });
                    return;
                }
                try {
                    const r = await fetch(`https://api.infiniteflight.com/public/v2/sessions/${f.sessionId}/flights/${f.flightId}/flightplan`, { headers });
                    const d = await r.json();
                    let origin = "N/A", dest = "N/A";
                    if (d && d.errorCode === 0 && d.result && Array.isArray(d.result.flightPlanItems) && d.result.flightPlanItems.length > 0) {
                        origin = d.result.flightPlanItems[0].identifier || "N/A";
                        dest = d.result.flightPlanItems[d.result.flightPlanItems.length - 1].identifier || "N/A";
                    }
                    flightPlanCache.set(f.flightId, { origin, dest });
                    results.push({ flightId: f.flightId, origin, dest });
                } catch(e) {
                    flightPlanCache.set(f.flightId, { origin: "N/A", dest: "N/A" });
                    results.push({ flightId: f.flightId, origin: "N/A", dest: "N/A" });
                }
            }));
            return res.status(200).json(results);
        }

        if (action === "stats") { /* İstatistik kodu (Aynı) */
            let payload = userId ? { userIds: [userId] } : { discourseNames: [username] };
            const response = await fetch('https://api.infiniteflight.com/public/v2/users', { method: 'POST', headers, body: JSON.stringify(payload) });
            return res.status(200).json(await response.json());
        }

        if (action === "route") { /* Tekil Rota Kodu (Aynı) */
            const response = await fetch(`https://api.infiniteflight.com/public/v2/sessions/${sessionId}/flights/${flightId}/flightplan`, { headers });
            const data = await response.json();
            let routeCoords = []; let origin = "N/A", dest = "N/A";
            if (data && data.errorCode === 0 && data.result && Array.isArray(data.result.flightPlanItems)) {
                const items = data.result.flightPlanItems;
                if(items.length > 0) {
                    origin = items[0].identifier || "N/A";
                    dest = items[items.length - 1].identifier || "N/A";
                    const extractWp = (itms) => {
                        if(!Array.isArray(itms)) return;
                        itms.forEach(i => {
                            if (i.children && Array.isArray(i.children) && i.children.length > 0) extractWp(i.children);
                            else if (i.location && i.location.latitude !== 0) routeCoords.push({ name: i.name || i.identifier || "" });
                        });
                    };
                    extractWp(items);
                }
            }
            return res.status(200).json({ originAirport: origin, destinationAirport: dest, route: routeCoords });
        }

        if (action === "atis") { /* ATIS Kodu (Aynı) */
            const targetIcao = airportIcao || icao;
            const response = await fetch(`https://api.infiniteflight.com/public/v2/sessions/${sessionId}/airport/${targetIcao}/atis`, { headers });
            return res.status(200).json(await response.json());
        }

        // ----------------------------------------------------
        // MODÜL 4: ANA VERİ (MASTER CACHE KONTROLÜ)
        // ----------------------------------------------------
        const now = Date.now();
        const CACHE_LIFETIME = 15000; // 15 saniye boyunca IF API'sine asla gitme

        // HAFIZADA VERİ VARSA ANINDA (0.001 Saniyede) EKRANA BAS!
        if (masterCache.flights.length > 0 && (now - masterCache.lastFetch < CACHE_LIFETIME)) {
            return sendCachedResponse(res);
        }

        // EĞER ŞU AN ARKA PLANDA GÜNCELLENİYORSA BEKLEME, ESKİ VERİYİ ANINDA BAS!
        if (masterCache.isUpdating && masterCache.flights.length > 0) {
            return sendCachedResponse(res);
        }

        // YENİ VERİYİ ÇEK (Sadece 15 Saniyede Bir Buraya Girer)
        masterCache.isUpdating = true;
        try {
            const [sessionsRes, liveriesRes] = await Promise.all([
                fetch('https://api.infiniteflight.com/public/v2/sessions', { headers }),
                fetch('https://api.infiniteflight.com/public/v2/aircraft/liveries', { headers })
            ]);
            
            const sessionsData = await sessionsRes.json();
            const liveriesData = await liveriesRes.json();
            
            if (sessionsData.errorCode && sessionsData.errorCode !== 0) {
                masterCache.isUpdating = false;
                return res.status(200).json({ warning: "IF API Reddetti", if_errorCode: sessionsData.errorCode });
            }

            const sessions = Array.isArray(sessionsData.result) ? sessionsData.result : [];
            const liveries = Array.isArray(liveriesData.result) ? liveriesData.result : [];
            const liveryMap = {};
            liveries.forEach(l => { liveryMap[l.id] = { aircraft: l.aircraftName, livery: l.liveryName }; });

            let tempFlights = [];
            let tempAtc = [];

            await Promise.all(sessions.map(async (session) => {
                const [fltRes, atcRes] = await Promise.all([
                    fetch(`https://api.infiniteflight.com/public/v2/sessions/${session.id}/flights`, { headers }),
                    fetch(`https://api.infiniteflight.com/public/v2/sessions/${session.id}/atc`, { headers })
                ]);
                
                const fltData = await fltRes.json();
                const atcData = await atcRes.json();
                
                if (fltData && Array.isArray(fltData.result)) {
                    fltData.result.forEach(f => {
                        const mappedLiv = liveryMap[f.liveryId] || { aircraft: "Unknown Aircraft", livery: "Unknown Livery" };
                        tempFlights.push({
                            flightId: f.flightId, userId: f.userId, sessionId: session.id, serverName: session.name,
                            callsign: f.callsign || "Unknown", username: f.username || "Guest", virtualOrganization: f.virtualOrganization || "",
                            aircraftName: mappedLiv.aircraft, liveryName: mappedLiv.livery, altitude: f.altitude, speed: f.speed
                        });
                    });
                }
                
                if (atcData && Array.isArray(atcData.result)) {
                    atcData.result.forEach(a => {
                        tempAtc.push({ sessionId: session.id, serverName: session.name, airportName: a.airportName, type: a.type, username: a.username });
                    });
                }
            }));

            masterCache.flights = tempFlights;
            masterCache.atc = tempAtc;
            masterCache.lastFetch = Date.now();
        } finally {
            masterCache.isUpdating = false;
        }

        return sendCachedResponse(res);

    } catch (err) {
        return res.status(500).json({ error: "Backend Crash", details: err.message });
    }
}

// ORTAK YANIT FONKSİYONU: Rotaları birleştirip şimşek gibi döner
function sendCachedResponse(res) {
    const finalFlights = masterCache.flights.map(f => {
        const routeInfo = flightPlanCache.get(f.flightId) || { origin: "Loading", dest: "Loading" };
        return { ...f, originAirport: routeInfo.origin, destinationAirport: routeInfo.dest };
    });
    return res.status(200).json({ result: finalFlights, atc: masterCache.atc });
}
