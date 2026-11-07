/*
 * flight-alert.js
 * Red banner when a plane is about to pass within 1/2 mile of your location.
 * Drop-in: add <script src="flight-alert.js"></script> before </body>.
 *
 * Test mode: add ?flighttest to the page URL, or triple-tap the top-left corner.
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
    holdSec: 6,         // keep banner up this long after flyover
    pollSec: 12,        // how often to check the feed (free key allows 300,000 a month)
    searchNm: 10,       // feed search radius (nautical miles)
    apiKey: 'fia_VxmxxyDXgd4q9t-TODA-TC89-h1o09fuOCPCLLu_LWA',   // free FlyItalyADSB key
    debug: false,
    sound: true,                // two soft beeps when a new plane alert starts
    soundVolume: 0.18,          // 0 to 1; keep it low, it is meant to be subtle
    soundQuietHours: null,      // e.g. [22, 7] = no beeps from 10 PM to 7 AM
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
    pass: '-', route: '-', sound: '-', tries: [] };

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
        destination: 'Las Vegas (Harry Reid International Airport)'
      });
      return;
    }
    routeCache.set(cs, 'pending');
    fetchJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs))
      .then((j) => {
        const fr = j && j.response && j.response.flightroute;
        routeCache.set(cs, fr ? {
          airline: fr.airline && fr.airline.name || null,
          origin: placeName(fr.origin),
          destination: placeName(fr.destination)
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

  /* ---------- state ---------- */

  const active = new Map();   // hex -> {ac, arriveAt, updatedAt}

  async function poll() {
    if (typeof document !== 'undefined' && document.hidden && !CFG.test) return;      // a hidden tab isn't watching the sky
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
          active.set(ac.hex, { ac, arriveAt, updatedAt: now });
          if (!prev) chime();                    // beep once per plane, when its alert starts
        } else if (was && !qualifies(ac, proj, true)) {
          active.delete(ac.hex);   // turned away or went out of range
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

  /* ---------- UI ---------- */

  let el = null, dbgEl = null, baseHtmlPad = '', shown = false;

  function buildUi() {
    const css = document.createElement('style');
    css.textContent = [
      '#fa-banner{position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;align-items:center;gap:28px;',
      'padding:calc(env(safe-area-inset-top,0px) + 18px) 32px 18px;',
      'background:#d70f1a;color:#fff;border-bottom:6px solid #fff;',
      'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif;',
      'transform:translateY(-110%);transition:transform .45s cubic-bezier(.2,.9,.25,1);box-sizing:border-box}',
      '#fa-banner.fa-on{transform:translateY(0);box-shadow:0 10px 40px rgba(215,15,26,.55),0 0 0 4px #d70f1a}',
      '#fa-banner .fa-icon{font-size:64px;line-height:1;flex:none;display:inline-block;transform:rotate(-20deg)}',
      '#fa-banner .fa-main{flex:1;min-width:0}',
      '#fa-banner .fa-l1{font-size:38px;font-weight:800;line-height:1.1;letter-spacing:-.01em}',
      '#fa-banner .fa-l2{font-size:26px;font-weight:600;line-height:1.25;margin-top:6px}',
      '#fa-banner .fa-l3{font-size:24px;font-weight:500;line-height:1.25;margin-top:8px;opacity:.95}',
      '#fa-banner .fa-l3 b{font-weight:800}',
      '#fa-banner .fa-credit{font-size:13px;font-weight:500;margin-top:8px;opacity:.7}',
      '#fa-debug{position:fixed;left:8px;bottom:8px;z-index:2147483100;max-width:92vw;padding:8px 10px;',
      'background:rgba(0,0,0,.78);color:#9dff9d;font:12px/1.35 ui-monospace,Menlo,monospace;border-radius:6px;',
      'white-space:pre-wrap;pointer-events:none}',
      '#fa-banner .fa-l3 span+span{margin-left:28px}',
      '#fa-banner .fa-count{flex:none;text-align:right;font-variant-numeric:tabular-nums}',
      '#fa-banner .fa-count .fa-num{font-size:84px;font-weight:900;line-height:.95;letter-spacing:-.02em}',
      '#fa-banner .fa-count .fa-sub{font-size:20px;font-weight:600;opacity:.9;margin-top:4px}',
      '#fa-banner .fa-more{display:inline-block;margin-left:14px;padding:2px 12px;border-radius:999px;',
      'background:#fff;color:#d70f1a;font-size:20px;font-weight:800;vertical-align:middle}',
      '#fa-banner .fa-test{display:inline-block;margin-right:14px;padding:2px 12px;border-radius:6px;',
      'background:#111;color:#fff;font-size:20px;font-weight:800;vertical-align:middle}',
      '@keyframes fa-pulse{0%,100%{box-shadow:0 10px 40px rgba(215,15,26,.55),0 0 0 4px #d70f1a}',
      '50%{box-shadow:0 10px 60px rgba(255,40,40,.95),0 0 0 4px #ff3b3b}}',
      '#fa-banner.fa-on{animation:fa-pulse 1.4s ease-in-out infinite}',
      '@media (prefers-reduced-motion:reduce){#fa-banner.fa-on{animation:none}}',
      '@media (max-width:820px){#fa-banner{gap:16px;padding-left:18px;padding-right:18px}',
      '#fa-banner .fa-icon{display:none}#fa-banner .fa-l1{font-size:26px}#fa-banner .fa-l2{font-size:19px}',
      '#fa-banner .fa-l3{font-size:17px}#fa-banner .fa-count .fa-num{font-size:52px}}'
    ].join('');
    document.head.appendChild(css);

    el = document.createElement('div');
    el.id = 'fa-banner';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="fa-icon" aria-hidden="true">\u2708\uFE0E</div>' +
      '<div class="fa-main"><div class="fa-l1"></div><div class="fa-l2"></div><div class="fa-l3"></div>' +
      '<div class="fa-credit">Flight data: FlyItalyADSB (flyitalyadsb.com), CC BY-SA 4.0</div></div>' +
      '<div class="fa-count"><div class="fa-num"></div><div class="fa-sub"></div></div>';
    document.body.appendChild(el);

    dbgEl = document.createElement('div');
    dbgEl.id = 'fa-debug';
    dbgEl.style.display = 'none';
    document.body.appendChild(dbgEl);

    baseHtmlPad = document.documentElement.style.paddingTop || '';
    document.documentElement.style.transition = 'padding-top .45s cubic-bezier(.2,.9,.25,1)';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  function fmtCountdown(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function render(top, extra, now) {
    const ac = top.ac;
    const cs = callsignOf(ac);
    const route = routeCache.get(cs);
    const r = route && route !== 'pending' ? route : null;
    const airline = (r && r.airline) || airlineFromCallsign(cs);

    const l1 = (CFG.test ? '<span class="fa-test">TEST</span>' : '') +
      esc([airline, cs].filter(Boolean).join(' ') || 'Unidentified aircraft') +
      (extra > 0 ? '<span class="fa-more">+' + extra + ' more</span>' : '');

    let l2 = esc(aircraftName(ac));
    if (r && r.origin && r.destination) l2 += '&nbsp;&nbsp;\u2014&nbsp;&nbsp;' + esc(r.origin) + ' to ' + esc(r.destination);
    else if (r && r.destination) l2 += '&nbsp;&nbsp;\u2014&nbsp;&nbsp;heading to ' + esc(r.destination);

    const a = altFt(ac);
    const mph = Math.round(ac.gs * KT_TO_MPH);
    const l3 = '<span>Overhead at <b>' + fmtClock(top.arriveAt) + '</b></span>' +
      (a != null ? '<span><b>' + a.toLocaleString() + '</b> ft</span>' : '') +
      '<span><b>' + mph + '</b> mph</span>';

    const secs = (top.arriveAt - now) / 1000;
    let num, sub;
    if (secs > 0.5) { num = fmtCountdown(secs); sub = 'until flyover'; }
    else if (secs > -CFG.holdSec) { num = 'NOW'; sub = 'overhead'; }
    else { num = '\u2014'; sub = 'just passed'; }

    el.querySelector('.fa-l1').innerHTML = l1;
    el.querySelector('.fa-l2').innerHTML = l2;
    el.querySelector('.fa-l3').innerHTML = l3;
    el.querySelector('.fa-num').textContent = num;
    el.querySelector('.fa-sub').textContent = sub;
  }

  function setShown(on) {
    if (on === shown) return;
    shown = on;
    el.classList.toggle('fa-on', on);
    const h = on ? el.offsetHeight : 0;
    document.documentElement.style.paddingTop = on ? h + 'px' : baseHtmlPad;
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
      'alerts active: ' + active.size + '  banner ' + (shown ? 'ON' : 'off') + '\n' +
      'route lookup: ' + dbg.route + '\n' +
      'sound: ' + dbg.sound;
  }

  function tick() {
    const now = Date.now();
    renderDebug(now);
    for (const [hex, a] of active) {
      if (now > a.arriveAt + CFG.holdSec * 1000 || now - a.updatedAt > 20000) active.delete(hex);
    }
    if (!active.size) { setShown(false); return; }
    const sorted = [...active.values()].sort((x, y) => x.arriveAt - y.arriveAt);
    render(sorted[0], sorted.length - 1, now);
    setShown(true);
    if (shown) document.documentElement.style.paddingTop = el.offsetHeight + 'px'; // text may re-wrap
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

  const api = { CFG, projectApproach, qualifies, aircraftName, airlineFromCallsign, fakeAircraft, poll, dbg, active, chime,
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
