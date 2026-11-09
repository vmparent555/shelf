/*
 * flight-alert.js
 * Red banner when a plane is about to pass within 1/2 mile of your location.
 * Drop-in: add <script src="flight-alert.js"></script> before </body>.
 *
 * Test mode: add ?flighttest to the page URL, or triple-tap the top-left corner.
 * Flight data: FlyItalyADSB (flyitalyadsb.com), licensed CC BY-SA 4.0. Route lookup: adsbdb.com.
 * Debug panel: add ?flightdebug, or triple-tap the bottom-left corner. It shows what
 * the flight feed is returning, so a silent failure is visible.
 * Override any setting before this script loads:
 *   window.FLIGHT_ALERT_CONFIG = { leadSec: 20, maxAltFt: 40000 };
 */
(function () {
  'use strict';

  const CFG = Object.assign({
    lat: 39.73805,
    lon: -105.04982,
    radiusMi: 0.5,      // alert if predicted closest approach is inside this
    leadSec: 30,        // show banner this many seconds before flyover
    holdSec: 13,        // keep the red screen up this long after the flyover
    pollSec: 12,        // how often to check the feed (free key allows 300,000 a month)
    nightPollSec: 24,   // overnight the page only counts planes, a bit less often
    searchNm: 10,       // feed search radius (nautical miles)
    apiKey: 'fia_VxmxxyDXgd4q9t-TODA-TC89-h1o09fuOCPCLLu_LWA',   // free FlyItalyADSB key
    debug: false,
    sound: true,                // two soft beeps when a new plane alert starts
    soundVolume: 0.18,          // 0 to 1; keep it low, it is meant to be subtle
    soundQuietHours: [21, 9],   // silent from 9 PM until 9 AM; set to null for beeps at any hour
    maxAltFt: null,     // e.g. 40000 to ignore high overflights
    minAltFt: null,     // e.g. 500 to ignore ground-level noise
    minSpeedKt: 40,     // ignore helicopters hovering / slow stuff
    test: false
  }, (typeof window !== 'undefined' && window.FLIGHT_ALERT_CONFIG) || {});

  const MI_PER_DEG = 69.093;
  const KT_TO_MPH = 1.15078;

  /* ---------- lookup tables ---------- */

  const AIRLINES = {
    UAL: 'United Airlines', DAL: 'Delta Air Lines', AAL: 'American Airlines',
    SWA: 'Southwest Airlines', FFT: 'Frontier Airlines', ASA: 'Alaska Airlines',
    JBU: 'JetBlue Airways', NKS: 'Spirit Airlines', AAY: 'Allegiant Air',
    SCX: 'Sun Country Airlines', HAL: 'Hawaiian Airlines', SKW: 'SkyWest Airlines',
    RPA: 'Republic Airways', ENY: 'Envoy Air', EDV: 'Endeavor Air',
    ASH: 'Mesa Airlines', GJS: 'GoJet Airlines', CPZ: 'Compass Airlines',
    UPS: 'UPS Airlines', FDX: 'FedEx Express', GTI: 'Atlas Air', ABX: 'ABX Air',
    ACA: 'Air Canada', WJA: 'WestJet', AMX: 'Aeromexico', VOI: 'Volaris',
    BAW: 'British Airways', DLH: 'Lufthansa', AFR: 'Air France', KLM: 'KLM',
    VIR: 'Virgin Atlantic', ICE: 'Icelandair', JAL: 'Japan Airlines', ANA: 'All Nippon Airways',
    KAL: 'Korean Air', UAE: 'Emirates', QFA: 'Qantas', EJA: 'NetJets',
    LXJ: 'Flexjet', JTL: 'Jet Linx', LIFEGUARD: 'Air Medical Flight'
  };

  const TYPES = {
    B731: 'Boeing 737-100', B732: 'Boeing 737-200', B733: 'Boeing 737-300', B734: 'Boeing 737-400',
    B735: 'Boeing 737-500', B736: 'Boeing 737-600', B737: 'Boeing 737-700', B738: 'Boeing 737-800',
    B739: 'Boeing 737-900', B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8',
    B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
    B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200', B753: 'Boeing 757-300',
    B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400',
    B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9',
    B788: 'Boeing 787-8 Dreamliner', B789: 'Boeing 787-9 Dreamliner', B78X: 'Boeing 787-10 Dreamliner',
    A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
    A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
    A306: 'Airbus A300-600', A310: 'Airbus A310', A332: 'Airbus A330-200', A333: 'Airbus A330-300',
    A338: 'Airbus A330-800neo', A339: 'Airbus A330-900neo', A342: 'Airbus A340-200', A343: 'Airbus A340-300',
    A346: 'Airbus A340-600', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
    E135: 'Embraer ERJ-135', E145: 'Embraer ERJ-145', E170: 'Embraer 170', E75L: 'Embraer 175',
    E75S: 'Embraer 175', E190: 'Embraer 190', E195: 'Embraer 195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
    CRJ2: 'Bombardier CRJ-200', CRJ7: 'Bombardier CRJ-700', CRJ9: 'Bombardier CRJ-900', CRJX: 'Bombardier CRJ-1000',
    DH8A: 'De Havilland Dash 8-100', DH8D: 'De Havilland Dash 8 Q400', AT76: 'ATR 72-600',
    MD11: 'McDonnell Douglas MD-11', MD82: 'McDonnell Douglas MD-82', MD83: 'McDonnell Douglas MD-83',
    MD88: 'McDonnell Douglas MD-88', MD90: 'McDonnell Douglas MD-90', B712: 'Boeing 717',
    C172: 'Cessna 172 Skyhawk', C182: 'Cessna 182 Skylane', C206: 'Cessna 206', C208: 'Cessna 208 Caravan',
    C210: 'Cessna 210 Centurion', C310: 'Cessna 310', C340: 'Cessna 340', C414: 'Cessna 414',
    C421: 'Cessna 421', C510: 'Cessna Citation Mustang', C525: 'Cessna CitationJet', C550: 'Cessna Citation II',
    C560: 'Cessna Citation V', C56X: 'Cessna Citation Excel', C680: 'Cessna Citation Sovereign',
    C700: 'Cessna Citation Longitude', C750: 'Cessna Citation X',
    PC12: 'Pilatus PC-12', PC24: 'Pilatus PC-24', SR20: 'Cirrus SR20', SR22: 'Cirrus SR22', SF50: 'Cirrus Vision Jet',
    BE20: 'Beechcraft King Air 200', BE35: 'Beechcraft Bonanza', BE36: 'Beechcraft Bonanza A36',
    BE9L: 'Beechcraft King Air 90', BE58: 'Beechcraft Baron 58', B350: 'Beechcraft King Air 350',
    PA28: 'Piper Cherokee', PA32: 'Piper Cherokee Six', PA46: 'Piper Malibu', M20P: 'Mooney M20',
    TBM7: 'Daher TBM 700', TBM8: 'Daher TBM 850', TBM9: 'Daher TBM 900', DA40: 'Diamond DA40', DA42: 'Diamond DA42',
    GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', GLEX: 'Bombardier Global Express',
    GL5T: 'Bombardier Global 5000', GL7T: 'Bombardier Global 7500', CL30: 'Bombardier Challenger 300',
    CL35: 'Bombardier Challenger 350', CL60: 'Bombardier Challenger 600', LJ35: 'Learjet 35', LJ45: 'Learjet 45',
    LJ60: 'Learjet 60', FA7X: 'Dassault Falcon 7X', FA50: 'Dassault Falcon 50', F900: 'Dassault Falcon 900',
    H25B: 'Hawker 800', E55P: 'Embraer Phenom 300', E50P: 'Embraer Phenom 100',
    R44: 'Robinson R44 helicopter', R22: 'Robinson R22 helicopter', EC35: 'Airbus H135 helicopter',
    EC30: 'Airbus H130 helicopter', A139: 'AgustaWestland AW139 helicopter', B06: 'Bell 206 helicopter',
    B407: 'Bell 407 helicopter', B429: 'Bell 429 helicopter', S76: 'Sikorsky S-76 helicopter'
  };

  const NO_TYPE_PLACEHOLDER = 'Unknown aircraft type';

  /* ---------- geometry ---------- */

  function toXY(lat, lon) {
    return {
      x: (lon - CFG.lon) * Math.cos(CFG.lat * Math.PI / 180) * MI_PER_DEG,
      y: (lat - CFG.lat) * MI_PER_DEG
    };
  }

  // Straight-line projection of closest approach. Returns seconds until closest
  // approach (0 if already past it) and the miss distance in miles.
  function projectApproach(ac) {
    const p = toXY(ac.lat, ac.lon);
    const mps = ac.gs * KT_TO_MPH / 3600;                 // miles per second
    const th = ac.track * Math.PI / 180;
    const v = { x: Math.sin(th) * mps, y: Math.cos(th) * mps };
    const age = ac.seen_pos || 0;                         // position is this old
    p.x += v.x * age; p.y += v.y * age;
    const v2 = v.x * v.x + v.y * v.y;
    const raw = v2 > 0 ? -(p.x * v.x + p.y * v.y) / v2 : Infinity;
    const t = Math.max(raw, 0);
    const miss = Math.hypot(p.x + v.x * t, p.y + v.y * t);
    return { etaSec: t, rawEta: raw, missMi: miss, distMi: Math.hypot(p.x, p.y) };
  }

  function altFt(ac) {
    const a = ac.alt_baro;
    if (a === 'ground' || a == null || typeof a !== 'number') return null;
    return a;
  }

  /* ---------- does the looked-up route fit where the plane really is? ---------- */

  const EARTH_MI = 3958.8;
  const toRad = (d) => d * Math.PI / 180;

  function milesBetween(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_MI * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(a, b) {
    const dLon = toRad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
      Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // Route databases match on flight number, which airlines reuse. So only trust a route
  // if the plane is actually near the line between its two airports and, when it is
  // clearly en route, flying toward the destination rather than away from it.
  function routeFits(route, ac) {
    if (!route || !route.o || !route.d) return false;            // can't verify, so don't show it
    const plane = { lat: ac.lat, lon: ac.lon };
    const total = milesBetween(route.o, route.d);
    if (total < 30) return true;                                  // too short to judge
    const fromO = milesBetween(route.o, plane);
    const fromD = milesBetween(route.d, plane);
    const detour = fromO + fromD - total;                         // ~0 when the plane is on the line
    if (detour > Math.max(40, 0.08 * total)) return false;
    if (fromO < 40 || fromD < 40) return true;                    // near an airport planes turn every which way
    let diff = Math.abs(bearingDeg(plane, route.d) - ac.track) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff <= 100;
  }

  function qualifies(ac, proj, alreadyActive) {
    if (ac.lat == null || ac.lon == null || ac.gs == null || ac.track == null) return false;
    if (ac.gs < CFG.minSpeedKt) return false;
    if (ac.alt_baro === 'ground') return false;
    const a = altFt(ac);
    if (a != null) {
      if (CFG.maxAltFt != null && a > CFG.maxAltFt) return false;
      if (CFG.minAltFt != null && a < CFG.minAltFt) return false;
    }
    const radius = CFG.radiusMi * (alreadyActive ? 1.6 : 1); // hysteresis so it doesn't flicker
    return proj.missMi <= radius;
  }

  /* ---------- naming ---------- */

  function titleCase(s) {
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
      .replace(/\b(Boeing|Airbus|Cessna|Embraer) ([a-z]+)/g, '$1 $2');
  }

  function aircraftName(ac) {
    if (ac.t && TYPES[ac.t]) return TYPES[ac.t];
    if (ac.desc) return titleCase(ac.desc);
    if (ac.t) return ac.t;
    return NO_TYPE_PLACEHOLDER;
  }

  function callsignOf(ac) { return (ac.flight || '').trim(); }

  function airlineFromCallsign(cs) {
    if (!cs) return null;
    const m = cs.match(/^([A-Z]{3})\d/);
    if (m && AIRLINES[m[1]]) return AIRLINES[m[1]];
    if (/^LIFEGUARD/.test(cs)) return AIRLINES.LIFEGUARD;
    if (/^N\d/.test(cs)) return 'Private aircraft';
    return null;
  }

  function placeName(p) {
    if (!p) return null;
    const city = p.municipality || '';
    const apt = p.name || '';
    if (city && apt) return city + ' (' + apt + ')';
    return city || apt || null;
  }

  /* ---------- data fetching ---------- */

  async function fetchJson(url, timeoutMs, headers) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs || 8000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store', headers: headers || {} });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  // The free no-key feeds (adsb.lol, adsb.fi, airplanes.live) don't allow web pages to read
  // them, so the keyed FlyItalyADSB feed is the main source. adsb.lol is a last resort.
  function feedList() {
    const feeds = [];
    if (CFG.apiKey) {
      feeds.push({
        name: 'FlyItalyADSB',
        url: 'https://api.flyitalyadsb.com/api/aircraft/v2/lat/' + CFG.lat + '/lon/' + CFG.lon +
          '/dist/' + CFG.searchNm + '/',
        headers: { 'X-Api-Key': CFG.apiKey }
      });
    }
    feeds.push({
      name: 'adsb.lol',
      url: 'https://api.adsb.lol/v2/point/' + CFG.lat + '/' + CFG.lon + '/' + CFG.searchNm,
      headers: {}
    });
    return feeds;
  }

  function explainError(e) {
    const msg = (e && e.message) || String(e);
    if (e && e.name === 'AbortError') return 'timed out';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'blocked or offline (' + msg + ')';
    return msg;
  }

  const dbg = { polls: 0, lastAt: 0, feed: '-', status: 'not polled yet', count: 0, nearest: '-',
    pass: '-', route: '-', sound: '-', today: 0, tries: [] };

  async function fetchAircraft() {
    if (CFG.test) { dbg.feed = 'test'; dbg.status = 'ghost plane'; return [fakeAircraft()]; }
    dbg.tries = [];
    for (const f of feedList()) {
      try {
        const j = await fetchJson(f.url, 8000, f.headers);
        const list = j && (j.ac || j.aircraft);
        if (!Array.isArray(list)) throw new Error('unexpected reply');
        dbg.feed = f.name; dbg.status = 'ok';
        return list;
      } catch (e) {
        dbg.tries.push(f.name + ': ' + explainError(e));
      }
    }
    dbg.feed = 'none'; dbg.status = 'FAILED';
    throw new Error(dbg.tries.join(' | '));
  }

  const routeCache = new Map();   // callsign -> {airline, origin, destination} | null | 'pending'

  function lookupRoute(cs) {
    if (!cs || routeCache.has(cs)) return;
    if (CFG.test) {
      routeCache.set(cs, {
        airline: 'Frontier Airlines',
        origin: 'Denver (Denver International Airport)',
        destination: 'Las Vegas (Harry Reid International Airport)',
        originCity: 'Denver', originAirport: 'Denver International Airport',
        destCity: 'Las Vegas', destAirport: 'Harry Reid International Airport',
        o: { lat: 39.8561, lon: -104.6737 },
        d: { lat: 36.0840, lon: -115.1537 }
      });
      return;
    }
    routeCache.set(cs, 'pending');
    fetchJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs))
      .then((j) => {
        const fr = j && j.response && j.response.flightroute;
        const point = (a) => (a && isFinite(parseFloat(a.latitude)) && isFinite(parseFloat(a.longitude)))
          ? { lat: parseFloat(a.latitude), lon: parseFloat(a.longitude) } : null;
        routeCache.set(cs, fr ? {
          airline: fr.airline && fr.airline.name || null,
          origin: placeName(fr.origin),
          destination: placeName(fr.destination),
          originCity: fr.origin && fr.origin.municipality || null,
          originAirport: fr.origin && fr.origin.name || null,
          destCity: fr.destination && fr.destination.municipality || null,
          destAirport: fr.destination && fr.destination.name || null,
          o: point(fr.origin),
          d: point(fr.destination)
        } : null);
        dbg.route = cs + (fr ? ': route found' : ': no route on file');
      })
      .catch((e) => { dbg.route = cs + ': lookup failed (' + explainError(e) + ')'; routeCache.delete(cs); });
  }

  /* ---------- test mode ghost plane ---------- */

  function fakeAircraft() {
    const cycle = 45;                                    // seconds per loop
    const t = (Date.now() / 1000) % cycle;
    const mph = 420, startMi = 3.4, offsetMi = 0.15;     // flies west to east, 0.15 mi north of you
    const xMi = -startMi + (mph / 3600) * t;
    return {
      hex: 'test01', flight: 'FFT1234 ', t: 'A20N', alt_baro: 12400,
      gs: mph / KT_TO_MPH, track: 90, seen_pos: 0,
      lat: CFG.lat + offsetMi / MI_PER_DEG,
      lon: CFG.lon + xMi / (MI_PER_DEG * Math.cos(CFG.lat * Math.PI / 180))
    };
  }

  /* ---------- night mode: index.html decides when it is night ---------- */

  function isNight() {
    try { return typeof window !== 'undefined' && typeof window.shelfIsNight === 'function' && window.shelfIsNight(); }
    catch (e) { return false; }
  }

  /* ---------- sound ---------- */

  // Browsers only allow audio after the page has been touched once. The tap that
  // advances a slide counts, so after each reload tap the screen once.
  let audioCtx = null;

  function unlockAudio() {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';   // play even on silent (iOS 16.4+)
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { dbg.sound = 'not supported here'; return; }
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state !== 'running') audioCtx.resume();
      dbg.sound = audioCtx.state === 'running' ? 'ready' : 'waiting for a tap';
    } catch (e) { dbg.sound = 'unavailable (' + explainError(e) + ')'; }
  }

  function beep(at, freq, dur, vol) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  function inQuietHours() {
    const q = CFG.soundQuietHours;
    if (!q) return false;
    const h = new Date().getHours();
    return q[0] <= q[1] ? (h >= q[0] && h < q[1]) : (h >= q[0] || h < q[1]);
  }

  function chime() {
    if (!CFG.sound) return;
    if (inQuietHours()) { dbg.sound = 'quiet hours'; return; }
    if (!audioCtx || audioCtx.state !== 'running') {
      dbg.sound = 'blocked: tap the screen once, then it will beep';
      return;
    }
    try {
      const t = audioCtx.currentTime + 0.03;
      beep(t, 880, 0.12, CFG.soundVolume);
      beep(t + 0.2, 880, 0.12, CFG.soundVolume);
      dbg.sound = 'played at ' + new Date().toLocaleTimeString();
    } catch (e) { dbg.sound = 'failed (' + explainError(e) + ')'; }
  }

  function setupAudioUnlock() {
    ['touchend', 'click', 'pointerdown', 'keydown'].forEach((name) => {
      document.addEventListener(name, unlockAudio, { passive: true });
    });
  }

  /* ---------- daily plane count: starts again at midnight ---------- */

  const COUNT_KEY = 'fa-plane-count-v1';
  const REPEAT_MS = 30 * 60 * 1000;   // the same plane circling back within this time keeps its number
  let memCount = null;

  function dayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function loadCount() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(COUNT_KEY) || 'null'); } catch (e) { /* no storage: fall back to memory */ }
    if (!c && memCount) c = memCount;
    if (!c || c.day !== dayKey()) c = { day: dayKey(), count: 0, recent: {} };
    return c;
  }

  function saveCount(c) {
    memCount = c;
    try { localStorage.setItem(COUNT_KEY, JSON.stringify(c)); } catch (e) { /* storage unavailable */ }
  }

  // Gives this plane today's next number (1, 2, 3 ...) the first time it is counted.
  function countPlane(hex) {
    const c = loadCount();
    const now = Date.now();
    const seen = c.recent[hex];
    if (seen && now - seen.at < REPEAT_MS) return seen.seq;
    c.count += 1;
    c.recent[hex] = { seq: c.count, at: now };
    Object.keys(c.recent).forEach((h) => { if (now - c.recent[h].at > REPEAT_MS) delete c.recent[h]; });
    saveCount(c);
    dbg.today = c.count;
    return c.count;
  }

  function ordinal(n) {
    const r = n % 100;
    if (r >= 11 && r <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  }

  /* ---------- state ---------- */

  const active = new Map();   // hex -> {ac, arriveAt, updatedAt, seq}
  let lastPollAt = 0;

  async function poll() {
    if (typeof document !== 'undefined' && document.hidden && !CFG.test) return;      // a hidden tab isn't watching the sky
    if (isNight()) {                                  // overnight: count planes quietly, a bit less often
      if (lastPollAt && Date.now() - lastPollAt < CFG.nightPollSec * 1000 - 500) return;
    }
    lastPollAt = Date.now();
    dbg.polls++;
    try {
      const list = await fetchAircraft();
      const now = Date.now();
      dbg.lastAt = now; dbg.count = list.length;
      let nearest = null, soonest = null;
      for (const ac of list) {
        if (ac.lat == null || ac.lon == null || ac.gs == null || ac.track == null) continue;
        const proj = projectApproach(ac);
        const was = active.has(ac.hex);
        if (!nearest || proj.distMi < nearest.proj.distMi) nearest = { ac, proj };
        if (proj.rawEta > 0 && proj.missMi < 2 && (!soonest || proj.rawEta < soonest.proj.rawEta)) soonest = { ac, proj };
        if (proj.missMi <= CFG.radiusMi * 1.6 && proj.etaSec <= 120) lookupRoute(callsignOf(ac));
        if (qualifies(ac, proj, was) && proj.etaSec <= CFG.leadSec) {
          const prev = active.get(ac.hex);
          // once it's past closest approach, freeze the flyover time instead of sliding it forward
          const arriveAt = prev && proj.rawEta < 0 ? prev.arriveAt : now + proj.etaSec * 1000;
          const seq = prev ? prev.seq : (CFG.test ? 12 : countPlane(ac.hex));   // the test plane never touches the real count
          active.set(ac.hex, { ac, arriveAt, updatedAt: now, seq });
          if (!prev && !isNight()) chime();      // beep once per plane, when its alert starts (never overnight)
        } else if (was && proj.rawEta > 0 && !qualifies(ac, proj, true)) {
          active.delete(ac.hex);   // turned away before reaching you; a plane already past stays up for the hold time
        }
      }
      dbg.nearest = nearest
        ? (callsignOf(nearest.ac) || nearest.ac.hex) + ' ' + nearest.proj.distMi.toFixed(1) + ' mi away'
        : 'none in range';
      dbg.pass = soonest
        ? (callsignOf(soonest.ac) || soonest.ac.hex) + ' passes ' + soonest.proj.missMi.toFixed(2) +
          ' mi away in ' + Math.round(soonest.proj.rawEta) + 's'
        : 'nothing heading this way';
    } catch (e) {
      dbg.lastAt = Date.now(); dbg.count = 0;
      dbg.nearest = '-'; dbg.pass = '-';
      dbg.status = 'FAILED: ' + explainError(e);
    }
  }

  /* ---------- UI: full-screen red alert ---------- */

  let el = null, dbgEl = null, shown = false, lastSig = '';

  function buildUi() {
    const css = document.createElement('style');
    css.textContent = [
      '#fa-alert{--k:1;position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;',
      'display:none;flex-direction:column;background:#cf0a14;color:#fff;',
      'padding:calc(21vmin + env(safe-area-inset-top,0px)) 7vmin calc(6vmin + env(safe-area-inset-bottom,0px));',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif}',
      '#fa-alert .fa-today{position:absolute;top:calc(9.6vmin + env(safe-area-inset-top,0px));left:7vmin;',
      'font-size:5.6vmin;font-weight:800;letter-spacing:-.005em}',
      '#fa-alert .fa-tag{position:absolute;top:calc(5vmin + env(safe-area-inset-top,0px));left:7vmin;',
      'font-size:3.2vmin;font-weight:800;letter-spacing:.16em;opacity:.92}',
      '#fa-alert .fa-chip{display:inline-block;margin-left:2vmin;padding:.4vmin 1.8vmin;border-radius:99px;',
      'background:#fff;color:#cf0a14;letter-spacing:.04em;font-size:3vmin}',
      '#fa-alert .fa-test{display:inline-block;margin-right:2vmin;padding:.4vmin 1.8vmin;border-radius:1vmin;',
      'background:#111;color:#fff;letter-spacing:.06em;font-size:3vmin}',
      '#fa-alert .fa-count{position:absolute;top:calc(4vmin + env(safe-area-inset-top,0px));right:5vmin;',
      'text-align:right;font-variant-numeric:tabular-nums}',
      '#fa-alert .fa-num{font-size:84px;font-weight:900;line-height:.95;letter-spacing:-.02em}',
      '#fa-alert .fa-sub{font-size:20px;font-weight:600;opacity:.9;margin-top:4px}',
      '#fa-alert .fa-content{flex:1;min-height:0;display:flex;flex-direction:column}',
      '#fa-alert .fa-content>:first-child{margin-top:auto}',
      '#fa-alert .fa-content>:last-child{margin-bottom:auto}',
      '#fa-alert .fa-content>*+*{margin-top:calc(4vmin*var(--k))}',
      '#fa-alert .fa-airline{font-size:calc(15vmin*var(--k));font-weight:800;line-height:1.05;letter-spacing:-.015em}',
      '#fa-alert .fa-flight{font-size:calc(8.4vmin*var(--k));font-weight:600;line-height:1.15}',
      '#fa-alert .fa-flight span+span{margin-left:4vmin}',
      '#fa-alert .fa-route{display:flex;flex-wrap:nowrap;align-items:flex-start}',
      '#fa-alert .fa-place{flex:0 1 auto;min-width:0}',
      '#fa-alert .fa-route.fa-stack{flex-direction:column}',
      '#fa-alert .fa-stack .fa-arrow{font-size:0;line-height:0;margin:0}',
      '#fa-alert .fa-stack .fa-arrow:after{content:"\\2193";display:block;font-size:calc(8vmin*var(--k));line-height:1.1}',
      '#fa-alert .fa-route:empty{display:none}',
      '#fa-alert .fa-place b{display:block;font-size:calc(13vmin*var(--k));font-weight:800;line-height:1.05}',
      '#fa-alert .fa-place small{display:block;font-size:calc(4.4vmin*var(--k));font-weight:500;opacity:.92;margin-top:.6vmin}',
      '#fa-alert .fa-arrow{flex:none;font-size:calc(11vmin*var(--k));font-weight:300;line-height:1.1;margin:0 3vmin}',
      '#fa-alert .fa-stats{display:flex;flex-wrap:wrap;font-size:calc(6.4vmin*var(--k));font-weight:600}',
      '#fa-alert .fa-stats:empty{display:none}',
      '#fa-alert .fa-stats b{font-size:calc(12vmin*var(--k));font-weight:800}',
      '#fa-alert .fa-stats span+span{margin-left:7vmin}',
      '#fa-debug{position:fixed;left:8px;bottom:8px;z-index:2147483100;max-width:92vw;padding:8px 10px;',
      'background:rgba(0,0,0,.78);color:#9dff9d;font:12px/1.35 ui-monospace,Menlo,monospace;border-radius:6px;',
      'white-space:pre-wrap;pointer-events:none}'
    ].join('');
    document.head.appendChild(css);

    el = document.createElement('div');
    el.id = 'fa-alert';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="fa-tag"><span class="fa-test" style="display:none">TEST</span>PLANE OVERHEAD' +
      '<span class="fa-chip" style="display:none"></span></div>' +
      '<div class="fa-today"></div>' +
      '<div class="fa-count"><div class="fa-num"></div><div class="fa-sub"></div></div>' +
      '<div class="fa-content"><div class="fa-airline"></div><div class="fa-flight"></div>' +
      '<div class="fa-route"></div><div class="fa-stats"></div></div>';
    document.body.appendChild(el);

    dbgEl = document.createElement('div');
    dbgEl.id = 'fa-debug';
    dbgEl.style.display = 'none';
    document.body.appendChild(dbgEl);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmtCountdown(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // Shrink the big text just enough that everything fits on the screen. Cities sit side by
  // side; if long names would force tiny text, they stack one above the other instead.
  function shrinkToFit(content) {
    let k = 1, guard = 0;
    el.style.setProperty('--k', k);
    while ((content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1) &&
           k > 0.45 && guard++ < 40) {
      k = Math.round((k - 0.04) * 100) / 100;
      el.style.setProperty('--k', k);
    }
    return k;
  }

  function fit() {
    const content = el.querySelector('.fa-content');
    const route = el.querySelector('.fa-route');
    route.classList.remove('fa-stack');
    const sideBySide = shrinkToFit(content);
    if (sideBySide >= 0.7 || !route.firstChild) return;
    route.classList.add('fa-stack');
    const stacked = shrinkToFit(content);
    if (stacked <= sideBySide) {
      route.classList.remove('fa-stack');
      shrinkToFit(content);
    }
  }

  function placeHtml(city, airport) {
    const big = city || airport || '';
    const small = city && airport ? airport : '';
    return '<div class="fa-place"><b>' + esc(big) + '</b>' + (small ? '<small>' + esc(small) + '</small>' : '') + '</div>';
  }

  function render(top, extra, now) {
    const ac = top.ac;
    const cs = callsignOf(ac);
    const route = routeCache.get(cs);
    const found = route && route !== 'pending' ? route : null;
    const fits = found ? routeFits(found, ac) : false;
    const r = fits ? found : null;
    if (found && !fits) dbg.route = cs + ': route did not match the plane\'s position, hidden';
    const airline = (found && found.airline) || airlineFromCallsign(cs);

    const a = altFt(ac);
    const mph = Math.round(ac.gs * KT_TO_MPH);
    const hasRoute = r && (r.originCity || r.originAirport) && (r.destCity || r.destAirport);

    const parts = {
      airline: esc(airline || cs || 'Unidentified aircraft'),
      flight: (airline && cs ? '<span>' + esc(cs) + '</span>' : '') + '<span>' + esc(aircraftName(ac)) + '</span>',
      route: hasRoute
        ? placeHtml(r.originCity, r.originAirport) + '<div class="fa-arrow">\u2192</div>' + placeHtml(r.destCity, r.destAirport)
        : '',
      stats: (a != null ? '<span><b>' + a.toLocaleString() + '</b> ft</span>' : '') +
        '<span><b>' + mph + '</b> mph</span>'
    };

    const sig = [parts.airline, parts.flight, parts.route, parts.stats, extra, CFG.test].join('|');
    if (sig !== lastSig) {
      el.querySelector('.fa-airline').innerHTML = parts.airline;
      el.querySelector('.fa-flight').innerHTML = parts.flight;
      el.querySelector('.fa-route').innerHTML = parts.route;
      el.querySelector('.fa-stats').innerHTML = parts.stats;
      const chip = el.querySelector('.fa-chip');
      chip.style.display = extra > 0 ? '' : 'none';
      chip.textContent = '+' + extra + ' more';
      el.querySelector('.fa-test').style.display = CFG.test ? '' : 'none';
      lastSig = sig;
      fit();
    }

    el.querySelector('.fa-today').textContent = top.seq ? ordinal(top.seq) + ' plane today' : '';

    const secs = (top.arriveAt - now) / 1000;
    let num, sub;
    if (secs >= 0.5) { num = fmtCountdown(secs); sub = 'until flyover'; }
    else if (secs > -0.5) { num = '0:00'; sub = 'overhead'; }
    else { num = '-' + fmtCountdown(-secs); sub = 'since flyover'; }
    el.querySelector('.fa-num').textContent = num;
    el.querySelector('.fa-sub').textContent = sub;
  }

  function setShown(on) {
    if (on === shown) return;
    shown = on;
    el.style.display = on ? 'flex' : 'none';
    if (!on) lastSig = '';
  }

  function renderDebug(now) {
    if (!dbgEl) return;
    dbgEl.style.display = CFG.debug ? '' : 'none';
    if (!CFG.debug) return;
    const age = dbg.lastAt ? Math.round((now - dbg.lastAt) / 1000) + 's ago' : 'never';
    dbgEl.textContent =
      'FLIGHT DEBUG  poll #' + dbg.polls + ', last ' + age + '\n' +
      'feed: ' + dbg.feed + '  ' + dbg.status + '\n' +
      (dbg.tries.length ? 'tried: ' + dbg.tries.join(' | ') + '\n' : '') +
      'aircraft within ' + CFG.searchNm + ' nm: ' + dbg.count + '\n' +
      'nearest: ' + dbg.nearest + '\n' +
      'next pass: ' + dbg.pass + '\n' +
      'alerts active: ' + active.size + '  red screen ' + (shown ? 'ON' : 'off') + '\n' +
      'route lookup: ' + dbg.route + '\n' +
      'sound: ' + dbg.sound + '\n' +
      'planes counted today: ' + loadCount().count + (isNight() ? '  (night: counting only)' : '');
  }

  function tick() {
    const now = Date.now();
    renderDebug(now);
    for (const [hex, a] of active) {
      const expired = now > a.arriveAt + CFG.holdSec * 1000;
      const vanished = now < a.arriveAt && now - a.updatedAt > 30000;   // dropped out of the feed before arriving
      if (expired || vanished) active.delete(hex);
    }
    if (isNight() || !active.size) { setShown(false); return; }         // overnight: no red screen, counting continues
    const sorted = [...active.values()].sort((x, y) => x.arriveAt - y.arriveAt);
    setShown(true);                      // show first: a hidden screen can't be measured for fitting
    render(sorted[0], sorted.length - 1, now);
  }

  /* ---------- test-mode triggers ---------- */

  function setupTestTriggers() {
    if (/[?&]flighttest/.test(location.search)) CFG.test = true;
    if (/[?&]flightdebug/.test(location.search)) CFG.debug = true;
    let topTaps = [], bottomTaps = [];
    document.addEventListener('pointerdown', (e) => {
      const now = Date.now();
      if (e.clientX < 90 && e.clientY < 90) {                       // top-left x3: test mode
        topTaps = topTaps.filter((t) => now - t < 1500).concat(now);
        if (topTaps.length >= 3) { topTaps = []; CFG.test = !CFG.test; active.clear(); poll(); }
      } else if (e.clientX < 90 && e.clientY > window.innerHeight - 90) {   // bottom-left x3: debug panel
        bottomTaps = bottomTaps.filter((t) => now - t < 1500).concat(now);
        if (bottomTaps.length >= 3) { bottomTaps = []; CFG.debug = !CFG.debug; }
      }
    }, { passive: true });
  }

  /* ---------- boot ---------- */

  const api = { CFG, projectApproach, qualifies, aircraftName, airlineFromCallsign, fakeAircraft, poll, dbg, active, chime, inQuietHours, routeFits, routeCache, countPlane, ordinal, loadCount, dayKey,
    _setAudio(ctx) { audioCtx = ctx; } };

  if (typeof document === 'undefined') {            // node: export for tests
    if (typeof module !== 'undefined') module.exports = api;
    return;
  }

  function start() {
    buildUi();
    setupTestTriggers();
    setupAudioUnlock();
    poll();
    setInterval(poll, CFG.pollSec * 1000);
    setInterval(tick, 500);
  }

  window.FlightAlert = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

