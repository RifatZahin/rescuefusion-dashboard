// RescueFusion: GitHub Pages Firebase authenticated read-only dashboard.
// Firebase client apiKey is PUBLIC configuration, never a service-account secret.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBo_O0p6p_7yNUK5al47JAT-e7m2AImmZk',
  authDomain: 'rescuefusion.firebaseapp.com',
  databaseURL: 'https://rescuefusion-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'rescuefusion',
  storageBucket: 'rescuefusion.firebasestorage.app',
  messagingSenderId: '178684140045',
  appId: '1:178684140045:web:7436750276f1bfafbb1344'
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const LIVE_PATH = 'robots/rescuefusion/live';
const $ = id => document.getElementById(id);
const arr = x => Array.isArray(x) ? x.filter(Boolean) : x && typeof x === 'object' ? Object.values(x).filter(Boolean) : [];
let detach = null, lastLive = null, currentLogs = [], clearThrough = 0, lastSession = null;
let firstEvents = true, lastEventId = 0, notificationsOn = false;

function statusBadge(text, cls='offline') {
  const el = $('onlineBadge'); el.className = 'pill ' + cls; el.lastElementChild.textContent = text;
}
function loginMessage(text, isError=false) {
  $('loginError').textContent = text; $('loginError').className = 'auth-message' + (isError ? ' error' : '');
}
function placeholder(text) {
  $('serialOutput').replaceChildren();
  const div = document.createElement('div'); div.className = 'placeholder-log'; div.textContent = text;
  $('serialOutput').appendChild(div); $('lineCount').textContent = '0 lines';
}
function showWaiting(text='Waiting for the PC-to-Firebase bridge to upload robot data.') {
  statusBadge('CLOUD READY · ROBOT WAITING'); $('topHint').textContent = text;
  $('outputStatus').textContent = text; $('outputTag').textContent = 'CLOUD WAITING';
  $('portName').textContent = 'REMOTE · FIREBASE';
  $('gpsValue').textContent = '—'; $('gpsTag').textContent = 'NO DATA';
  $('gpsExtra').textContent = 'Waiting for robot GPS telemetry.'; $('mapLink').hidden = true;
  $('obstacleValue').textContent = '—'; $('obstacleTag').textContent = 'NO DATA';
  $('gasValue').textContent = '—'; $('gasTag').textContent = 'NO DATA';
  $('cameraValue').textContent = '—'; $('cameraTag').textContent = 'NO DATA';
  $('uptimeValue').textContent = '—'; $('upTag').textContent = 'REMOTE';
  $('humanValue').textContent = 'Waiting'; $('events').replaceChildren(); $('eventCount').textContent = '0 events';
  placeholder(text);
}
function showLoggedOut() {
  $('loginPanel').hidden = false; $('siteShell').hidden = true;
  $('loginPassword').value = ''; lastLive = null; currentLogs = []; clearThrough = 0;
  lastSession = null; firstEvents = true; lastEventId = 0;
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginButton').disabled = true; loginMessage('Signing in...');
  const email = $('loginEmail').value.trim(), password = $('loginPassword').value;
  try {
    await setPersistence(auth, browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const code = err?.code || '';
    loginMessage(code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
      ? 'Email or password is incorrect.'
      : code === 'auth/network-request-failed' ? 'Network error: check Internet connection.'
      : code === 'auth/too-many-requests' ? 'Too many login attempts; please wait.'
      : 'Login error: ' + (code || 'unknown'), true);
  } finally { $('loginButton').disabled = false; $('loginPassword').value = ''; }
});
$('logoutBtn').onclick = async () => { try { await signOut(auth); } catch { $('topHint').textContent = 'Sign out failed. Retry.'; } };
onAuthStateChanged(auth, user => {
  if (detach) { detach(); detach = null; }
  if (!user) { showLoggedOut(); loginMessage('Enter your Firebase email and password.'); return; }
  $('loginPanel').hidden = true; $('siteShell').hidden = false;
  $('signedInAs').textContent = 'Signed in: ' + (user.email || 'Firebase account');
  showWaiting();
  detach = onValue(ref(database, LIVE_PATH), snap => receiveLive(snap.val()), error => {
    lastLive = null; statusBadge('DATABASE ACCESS ERROR');
    $('topHint').textContent = error.code === 'PERMISSION_DENIED' || /permission/i.test(error.message || '')
      ? 'Access denied. Check the UID in your Firebase Database Rules.'
      : 'Firebase read error: ' + (error.message || 'unknown');
    $('outputStatus').textContent = 'Do not make database public to fix access problems.';
  });
}, error => { showLoggedOut(); loginMessage('Authentication failure: ' + (error.code || error.message), true); });

// ESP32-CAM remains on private HTTP Wi-Fi; GitHub Pages is HTTPS.
$('cameraIP').value = localStorage.getItem('rescuefusion_cam_ip') || '';
function connectCamera() {
  const ip = $('cameraIP').value.trim();
  const p = ip.split('.');
  if (p.length !== 4 || !p.every(v => /^\d{1,3}$/.test(v) && Number(v) <= 255)) {
    $('streamNote').textContent = 'Enter a valid IPv4 address.'; return;
  }
  localStorage.setItem('rescuefusion_cam_ip', ip);
  $('openCam').href = `http://${ip}/`; $('openCam').hidden = false;
  $('cameraStream').hidden = true;
  $('cameraPlaceholder').hidden = false;
  $('cameraPlaceholder').textContent = 'Camera is on the local Wi-Fi. A GitHub HTTPS website cannot securely embed this HTTP video. Open the camera webpage on the same Wi-Fi; remote streaming needs a secure relay.';
  $('streamBadge').textContent = 'LAN ONLY';
  $('streamNote').textContent = 'Open camera webpage to view local MJPEG2SD video';
}
$('connectCam').onclick = connectCamera;
$('cameraIP').addEventListener('keydown', e => { if (e.key === 'Enter') connectCamera(); });
$('notifyBtn').onclick = async () => {
  if (!('Notification' in window)) { $('notifyBtn').textContent = 'Alerts unavailable'; return; }
  notificationsOn = await Notification.requestPermission() === 'granted';
  $('notifyBtn').textContent = notificationsOn ? 'Tab alerts enabled' : 'Alerts blocked';
};
$('clearOutput').onclick = () => {
  clearThrough = Math.max(clearThrough, ...currentLogs.map(x => Number(x.seq) || 0), 0);
  currentLogs = []; $('serialOutput').replaceChildren(); $('lineCount').textContent = '0 lines (view cleared)';
};
$('copyOutput').onclick = async () => {
  try {
    await navigator.clipboard.writeText(currentLogs.map(x => `[${x.time || '--'}] ${x.text || ''}`).join('\n'));
    $('copyOutput').textContent = 'Copied';
    setTimeout(() => $('copyOutput').textContent = 'Copy output', 1200);
  } catch { $('copyOutput').textContent = 'Copy unavailable'; }
};
function duration(t) {
  if (!Number.isFinite(t) || t < 0) return '—';
  const n = Math.floor(t);
  return `${Math.floor(n/3600)}h ${String(Math.floor((n%3600)/60)).padStart(2,'0')}m ${String(n%60).padStart(2,'0')}s`;
}
function drawStatus(data) {
  const s = data.status || {}, now = Date.now()/1000;
  const bridgeFresh = Number(data.updated_at_ms) > 0 && (Date.now()-Number(data.updated_at_ms)) < 30000 && (Date.now()-Number(data.updated_at_ms)) > -60000;
  const usbFresh = s.serial_connected === true && Number(s.last_line_at) > 0 && now-Number(s.last_line_at) < 25;
  const real = bridgeFresh && usbFresh && !s.demo;
  statusBadge(s.demo ? 'DEMO · NOT ROBOT' : real ? 'DEVKIT ONLINE · CLOUD LIVE' : bridgeFresh ? 'BRIDGE ONLINE · DEVKIT OFFLINE' : 'BRIDGE OFFLINE / STALE', s.demo ? 'demo' : real ? 'online' : 'offline');
  $('topHint').textContent = s.demo ? 'Demo data: not real telemetry.' : real ? 'Live PC USB → Firebase telemetry' : bridgeFresh ? 'Bridge connected. Waiting for serial data.' : 'No recent cloud update. Check PC bridge.';
  $('outputTag').textContent = real ? 'CLOUD LIVE' : bridgeFresh ? 'CONNECTED' : 'STALE';
  $('outputStatus').textContent = bridgeFresh ? 'Read-only ESP32 DevKit serial logs, forwarded by PC' : 'Cloud data may be stale; check PC bridge';
  $('portName').textContent = `${s.port || 'COM4'} · 115200 baud · cloud`;
  const gpsFresh = real && s.gps_valid === true && Number(s.gps_seen_at) > 0 && now-Number(s.gps_seen_at) < 15;
  const lat=Number(s.gps_lat), lng=Number(s.gps_lng);
  if (gpsFresh && Number.isFinite(lat) && Number.isFinite(lng) && s.gps_lat !== null && s.gps_lng !== null) {
    $('gpsTag').textContent = 'VALID FIX'; $('gpsTag').className = 'tag green';
    $('gpsValue').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    $('gpsExtra').textContent = `Robot GPS · ${s.gps_sats ?? '?'} satellites`;
    $('mapLink').href = `https://www.google.com/maps?q=${lat},${lng}`; $('mapLink').hidden = false;
  } else {
    $('gpsTag').textContent = 'NO FRESH FIX'; $('gpsTag').className = 'tag';
    $('gpsValue').textContent = '—'; $('gpsExtra').textContent = `Waiting for fresh GPS fix · ${s.gps_sats ?? '—'} satellites`;
    $('mapLink').hidden = true;
  }
  const front = real && s.front_cm != null ? Number(s.front_cm) : NaN;
  $('obstacleValue').textContent = Number.isFinite(front) ? front.toFixed(1) : '—';
  $('obstacleTag').textContent = !Number.isFinite(front) ? 'NO DATA' : front <= 20 ? 'NEAR' : 'CLEAR';
  $('obstacleTag').className = 'tag' + (Number.isFinite(front) && front <= 20 ? ' red' : '');
  $('gasValue').textContent = real && s.mq7_raw != null ? s.mq7_raw : '—';
  $('gasTag').textContent = !real ? 'NO DATA' : s.buzzer ? 'TEST ALERT' : 'RAW ADC';
  $('gasTag').className = 'tag' + (real && s.buzzer ? ' red' : '');
  const http = real ? s.camera_last_http : null;
  $('cameraValue').textContent = http == null ? '—' : `HTTP ${http}`;
  $('cameraTag').textContent = http == null ? 'NOT TESTED' : http === 200 ? 'LAST OK' : 'LAST FAILED';
  $('cameraTag').className = 'tag' + (http === 200 ? ' green' : http != null ? ' red' : '');
  $('uptimeValue').textContent = real && Number(s.session_started_at) ? duration(now-Number(s.session_started_at)) : '—';
  $('upTag').textContent = 'PC SESSION';
  $('humanValue').textContent = 'Waiting'; // AI inference not available
}
function drawLogs(raw) {
  currentLogs = arr(raw).filter(x => Number(x.seq) > clearThrough).slice(-120);
  const el = $('serialOutput'); el.replaceChildren();
  if (!currentLogs.length) { placeholder('No new ESP32 serial output sent to Firebase yet.'); return; }
  const frag=document.createDocumentFragment();
  for (const item of currentLogs) {
    const t = String(item.text || '').slice(0,1500);
    const div=document.createElement('div');
    div.className='log-line' + (/\bWARN\b|\bERROR\b|\bSTOP:|\bBLOCKED\b|\bFAULT\b/.test(t) ? ' warn' : /HTTP:\s*200|MOTOR FORWARD|WiFi connected/i.test(t) ? ' good' : '');
    const stamp=document.createElement('span'); stamp.className='log-ts'; stamp.textContent=`[${String(item.time || '--')}]`;
    div.append(stamp,document.createTextNode(t)); frag.appendChild(div);
  }
  el.appendChild(frag); $('lineCount').textContent=`${currentLogs.length} lines shown`;
  if ($('autoScroll').checked) el.scrollTop = el.scrollHeight;
}
function drawEvents(raw) {
  const items=arr(raw).slice(0,14), host=$('events'); host.replaceChildren();
  $('eventCount').textContent=`${items.length} recent events`;
  for (const item of items) {
    const div=document.createElement('div'); div.className='event '+(['warning','robot','info'].includes(item.kind) ? item.kind : 'info');
    const stamp=document.createElement('span'); stamp.className='event-time'; stamp.textContent=String(item.time || '');
    const message=document.createElement('span'); message.className='event-message'; message.textContent=String(item.message || '').slice(0,500);
    div.append(stamp,message); host.appendChild(div);
  }
  if (!items.length) { const p=document.createElement('p'); p.className='help'; p.textContent='Waiting for robot events.'; host.appendChild(p); }
  const highest=Math.max(0,...items.map(x => Number(x.id) || 0));
  if (!firstEvents && notificationsOn && highest > lastEventId) {
    for (const x of items.filter(v => Number(v.id)>lastEventId && v.kind==='warning')) {
      try { new Notification('RescueFusion sensor event', {body: String(x.message).slice(0,180)}); } catch { /* browser may block */ }
    }
  }
  firstEvents=false; lastEventId=Math.max(lastEventId,highest);
}
function receiveLive(data) {
  if (!data || typeof data !== 'object') { lastLive=null; showWaiting(); return; }
  const session=data.status?.session_started_at ?? null;
  if (lastSession !== session) { lastSession=session; clearThrough=0; firstEvents=true; lastEventId=0; }
  lastLive=data;
  drawStatus(data); drawLogs(data.output); drawEvents(data.events);
}
// If the bridge stops and Firebase no longer changes, stale data must not appear online.
setInterval(() => { if (lastLive && !$('siteShell').hidden) drawStatus(lastLive); }, 5000);
