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
const CAMERA_PATH = 'robots/rescuefusion/camera/latest';
const PIR_INSTALLED = false; // Set true only after wiring and verifying PIR telemetry.
const $ = id => document.getElementById(id);
const arr = x => Array.isArray(x) ? x.filter(Boolean) : x && typeof x === 'object' ? Object.values(x).filter(Boolean) : [];

function showPage(page) {
  const dashboard = page === 'dashboard';
  $('dashboardPage').hidden = !dashboard;
  $('controlPage').hidden = dashboard;
  $('navDashboard').classList.toggle('active', dashboard);
  $('navControl').classList.toggle('active', !dashboard);
  $('navDashboard').setAttribute('aria-current', dashboard ? 'page' : 'false');
  $('navControl').setAttribute('aria-current', dashboard ? 'false' : 'page');
}
$('navDashboard').addEventListener('click', () => showPage('dashboard'));
$('navControl').addEventListener('click', () => showPage('control'));
let detach = null, detachCamera = null, cloudFrame = null, lastLive = null, currentLogs = [], clearThrough = 0, lastSession = null;
let firstEvents = true, lastEventId = 0, notificationsOn = false;
let activeCameraPane = 'live';
let inlineLastFrameTime = 0;
let lastRescueEvent = null; // person/animal event paired with a later cloud still, session only
const RESCUE_CLASSES = new Set([
  'person','human','people','pedestrian','animal','bird','cat','dog','horse','sheep','cow',
  'elephant','bear','zebra','giraffe','tiger','lion','deer','goat','monkey','pig','rabbit',
  'fox','wolf','leopard','chicken','duck'
]);
function rescueSubjects(raw) {
  return [...new Set(String(raw || '').toLowerCase()
    .split(/[,;+]|\band\b/i)
    .map(label => label.trim().replace(/[_-]+/g, ' '))
    .filter(label => RESCUE_CLASSES.has(label)))];
}

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
  $('gpsExtra').textContent = 'Waiting for robot GPS telemetry.';
  $('obstacleValue').textContent = '—'; $('obstacleTag').textContent = 'NO DATA';
  $('gasValue').textContent = '—'; $('gasTag').textContent = 'NO DATA';
  $('cameraValue').textContent = '—'; $('cameraTag').textContent = 'NO DATA';
  $('uptimeValue').textContent = '—'; $('upTag').textContent = 'REMOTE';
  $('humanValue').textContent = 'Waiting'; $('humanTag').textContent = 'NO AI EVENT'; $('humanTag').className = 'tag'; $('humanMeta').textContent = 'Waiting for camera AI updates.';
  $('pirValue').textContent = 'PIR not installed yet'; $('pirTag').textContent = 'NOT INSTALLED'; $('pirTag').className = 'tag'; $('pirMeta').textContent = 'This sensor will be enabled after physical installation and telemetry testing.';
  $('detectionLocation').textContent = 'No detection location recorded yet.'; $('detectionLocationMeta').textContent = 'A fresh GPS fix is needed to attach a location.';
  $('buzzerState').textContent = 'Control unavailable'; $('buzzerButton').disabled = true;
  $('snapshotBadge').textContent = 'WAITING'; $('snapshotBadge').className = 'tag yellow';
  lastRescueEvent = null; $('events').replaceChildren(); $('eventCount').textContent = '0 events';
  placeholder(text);
}
function showLoggedOut() {
  stopInlineCamera();
  cloudFrame = null; $('cameraStream').hidden = true; $('cameraStream').removeAttribute('src');
  $('loginPanel').hidden = false; $('siteShell').hidden = true;
  $('loginPassword').value = ''; lastLive = null; currentLogs = []; clearThrough = 0;
  lastSession = null; firstEvents = true; lastEventId = 0; lastRescueEvent = null;
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
  if (detachCamera) { detachCamera(); detachCamera = null; }
  if (!user) { showLoggedOut(); loginMessage('Enter your Firebase email and password.'); return; }
  $('loginPanel').hidden = true; $('siteShell').hidden = false;
  $('signedInAs').textContent = 'Signed in: ' + (user.email || 'Firebase account');
  showWaiting();
  setCameraPane('live');
  detachCamera = onValue(ref(database, CAMERA_PATH), snap => displayCloudCamera(snap.val()), error => {
    if (activeCameraPane !== 'live') $('streamBadge').textContent = 'CAMERA ACCESS ERROR';
    $('streamNote').textContent = 'Cloud camera read denied. Check /robots/rescuefusion/camera Firebase rules.';
  });
  detach = onValue(ref(database, LIVE_PATH), snap => receiveLive(snap.val()), error => {
    lastLive = null; statusBadge('DATABASE ACCESS ERROR');
    $('topHint').textContent = error.code === 'PERMISSION_DENIED' || /permission/i.test(error.message || '')
      ? 'Access denied. Check the UID in your Firebase Database Rules.'
      : 'Firebase read error: ' + (error.message || 'unknown');
    $('outputStatus').textContent = 'Do not make database public to fix access problems.';
  });
}, error => { showLoggedOut(); loginMessage('Authentication failure: ' + (error.code || error.message), true); });


// Low-rate camera still frames travel PC -> authenticated Firebase -> GitHub Pages.
// This does NOT use the local MJPEG HTTP stream and is NOT continuous video.
function displayCloudCamera(snapshot) {
  const img = $('cameraStream');
  if (!snapshot || typeof snapshot !== 'object' || snapshot.mime !== 'image/jpeg' ||
      typeof snapshot.jpeg_base64 !== 'string' || !snapshot.jpeg_base64.startsWith('/9j/') ||
      snapshot.jpeg_base64.length > 210000) {
    cloudFrame = null; img.hidden = true; img.removeAttribute('src');
    $('cameraPlaceholder').hidden = false;
    $('cameraPlaceholder').textContent = 'Waiting for protected camera snapshots. Start camera_snapshot_relay.py on the PC.';
    $('snapshotBadge').textContent = 'CLOUD WAITING'; $('snapshotBadge').className = 'tag yellow';
    $('streamNote').textContent = 'Cloud snapshots not available yet — live MJPEG is still local-only';
    return;
  }
  const stamp = Number(snapshot.updated_at_ms);
  if (!Number.isFinite(stamp) || stamp < 1000000000000) return;
  cloudFrame = {updated_at_ms:stamp, bytes:Number(snapshot.bytes) || 0};
  linkSnapshotToRescueEvent(stamp);
  img.onload = () => { if(cloudFrame) { img.hidden=false; $('cameraPlaceholder').hidden=true; } };
  img.onerror = () => {img.hidden=true; $('cameraPlaceholder').hidden=false; $('cameraPlaceholder').textContent='Camera image decode failed.';};
  img.src='data:image/jpeg;base64,'+snapshot.jpeg_base64;
  updateCameraAge();
}
function linkSnapshotToRescueEvent(stamp) {
  if (lastRescueEvent && stamp > lastRescueEvent.aiUpdatedAt) {
    // This is the newest cloud still uploaded after the AI event, not a detector-triggered capture.
    lastRescueEvent.snapshotAt = stamp;
  }
}
function updateCameraAge() {
  if ($('siteShell').hidden) return;
  if (!cloudFrame) {
    if (lastRescueEvent) {
      $('snapshotBadge').textContent = 'AWAITING IMAGE'; $('snapshotBadge').className = 'tag yellow';
      $('streamNote').textContent = `${lastRescueEvent.label} detected · waiting for the existing PC snapshot relay to upload a newer photo.`;
    }
    return;
  }
  const ageSec = Math.max(0, Math.floor((Date.now()-cloudFrame.updated_at_ms)/1000));
  const stale = ageSec > 150;
  const postDetection = lastRescueEvent && lastRescueEvent.snapshotAt === cloudFrame.updated_at_ms;
  $('snapshotBadge').textContent = postDetection ? (stale ? 'EVENT IMAGE · STALE' : 'AFTER DETECTION') : stale ? 'SNAPSHOT STALE' : 'CLOUD SNAPSHOT';
  $('snapshotBadge').className = 'tag ' + (stale ? 'yellow' : 'green');
  if (postDetection) {
    const delaySec = Math.max(0, Math.floor((cloudFrame.updated_at_ms-lastRescueEvent.aiUpdatedAt)/1000));
    $('streamNote').textContent = `${lastRescueEvent.label} event · newest cloud photo uploaded ${delaySec}s later · ${ageSec}s old · relay-timed`;
  } else if (lastRescueEvent) {
    $('snapshotBadge').textContent = 'AWAITING IMAGE'; $('snapshotBadge').className = 'tag yellow';
    $('streamNote').textContent = `${lastRescueEvent.label} detected · waiting for a newer photo from the existing PC snapshot relay.`;
  } else {
    $('streamNote').textContent=`Last protected camera photo: ${ageSec}s ago · ${cloudFrame.bytes} bytes · NOT continuous video`;
  }
}
setInterval(updateCameraAge,5000);

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
  if (!cloudFrame) {
    $('cameraStream').hidden = true;
    $('cameraPlaceholder').hidden = false;
    $('cameraPlaceholder').textContent = 'Local camera is on Wi-Fi. Cloud snapshots need the PC camera relay.';
    $('snapshotBadge').textContent = 'CLOUD WAITING'; $('snapshotBadge').className = 'tag yellow';
  }
  $('streamNote').textContent = cloudFrame ? $('streamNote').textContent : 'Open camera webpage on the same Wi-Fi to view original MJPEG2SD video';
}
$('connectCam').onclick = connectCamera;
$('cameraIP').addEventListener('keydown', e => { if (e.key === 'Enter') connectCamera(); });
// Private or protected HTTPS video launcher. Only HTTPS Tailscale Serve / Cloudflare Quick Tunnels.
// URL is stored locally in the user's browser, never sent to Firebase.
const INITIAL_LIVE_VIDEO_URL = 'https://hamidy.tail65670e.ts.net/';
const liveVideoInput = $('globalVideoURL');
const liveVideoHint = $('globalVideoHint');
const liveVideoBadge = $('globalVideoBadge');
try { liveVideoInput.value = localStorage.getItem('rescuefusion_live_video_url') || INITIAL_LIVE_VIDEO_URL; }
catch { liveVideoInput.value = INITIAL_LIVE_VIDEO_URL; }
function normalizedProtectedVideoUrl(input) {
  try {
    const u = new URL(input.trim());
    const hostname = u.hostname.toLowerCase();
    const isTailscale = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(hostname);
    const isQuickTunnel = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com$/.test(hostname);
    // Prevent javascript:, userinfo, non-HTTPS, custom ports, redirects and unrelated URLs.
    if (u.protocol !== 'https:' || !(isTailscale || isQuickTunnel) ||
        u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) return null;
    return { url: u.origin + '/', isTailscale };
  } catch { return null; }
}
function labelVideoMode(mode) {
  if (!mode) return;
  liveVideoBadge.textContent = mode.isTailscale ? 'TAILSCALE PRIVATE' : 'EMAIL OTP';
}
labelVideoMode(normalizedProtectedVideoUrl(liveVideoInput.value));

// Embedded viewer is deliberately confined to our Tailscale Serve host.
// The /embed path is the only resource the updated PC relay permits GitHub Pages to frame.
const inlineFrame = $('inlineLiveFrame');
const inlinePane = $('inlineLivePane');
const inlineNote = $('inlineLiveNote');
function stopInlineCamera() {
  inlineFrame.removeAttribute('src'); // stop polling and release downstream requests
  inlineLastFrameTime = 0;
}
function setInlineCameraNote(text, state='') {
  inlineNote.textContent = text;
  inlineNote.className = 'inline-live-note' + (state ? ' '+state : '');
}
function setCameraPane(which) {
  // Show the existing private live view beside the Firebase snapshot.
  activeCameraPane = 'live';
  inlinePane.hidden = false;
  $('snapshotCameraPane').hidden = false;
  $('streamBadge').textContent = 'PRIVATE · CONNECTING';
  $('streamBadge').className = 'tag';
  const parsed=normalizedProtectedVideoUrl(liveVideoInput.value);
  if (!parsed || !parsed.isTailscale) {
    stopInlineCamera();
    setInlineCameraNote('The live view needs the saved private HTTPS Tailscale address. Use Camera connection options if the address changes.','error');
    $('streamBadge').textContent = 'TAILSCALE NEEDED';
    return;
  }
  setInlineCameraNote('Connecting to the private camera. This device needs Tailscale and the PC Relay must be running.');
  // Keep the validated private /embed endpoint and existing relay protocol.
  const endpoint=parsed.url+'embed';
  if (inlineFrame.getAttribute('src')!==endpoint) inlineFrame.src=endpoint;
}
$('showInlineGlobalVideo').onclick=()=>{
  const parsed=normalizedProtectedVideoUrl(liveVideoInput.value);
  if (!parsed || !parsed.isTailscale) {
    liveVideoHint.textContent='Inline video requires a valid HTTPS Tailscale *.ts.net root URL. Use Watch in New Tab for Cloudflare.';
    liveVideoHint.className='global-live-hint error';
    return;
  }
  try {localStorage.setItem('rescuefusion_live_video_url', parsed.url);} catch {}
  liveVideoInput.value=parsed.url;
  labelVideoMode(parsed);
  liveVideoHint.textContent='Private video opening inside the Camera box above. Your device must be connected to Tailscale.';
  liveVideoHint.className='global-live-hint';
  setCameraPane('live');
  $('inlineLivePane').scrollIntoView({block:'nearest',behavior:'smooth'});
};
window.addEventListener('message',(event)=>{
  const parsed=normalizedProtectedVideoUrl(liveVideoInput.value);
  if (!parsed || !parsed.isTailscale ||
      event.origin !== new URL(parsed.url).origin || event.source !== inlineFrame.contentWindow ||
      !event.data || event.data.type !== 'rescuefusion-camera-embedded') return;
  if(event.data.state==='live') {
    inlineLastFrameTime=Date.now();
    $('streamBadge').textContent='PRIVATE LIVE';
    $('streamBadge').className='tag green';
    setInlineCameraNote('Live camera in Dashboard · Tailscale private HTTPS · about 2 FPS','connected');
  } else if (event.data.state==='waiting' || event.data.state==='reconnecting') {
    $('streamBadge').textContent='VIDEO RETRYING';
    $('streamBadge').className='tag yellow';
    setInlineCameraNote('Waiting for a fresh camera frame. Check Tailscale connection, relay CMD and /health.','error');
  }
});
setInterval(()=>{
  if (activeCameraPane==='live' && inlineLastFrameTime && Date.now()-inlineLastFrameTime>12000) {
    $('streamBadge').textContent='VIDEO STALE';
    $('streamBadge').className='tag yellow';
    setInlineCameraNote('No new video frame for 12+ seconds. Check PC Relay, Tailscale and camera Wi-Fi.','error');
  }
},3000);

$('watchGlobalVideo').onclick = () => {
  const parsed = normalizedProtectedVideoUrl(liveVideoInput.value);
  if (!parsed) {
    liveVideoHint.textContent = 'Enter a valid HTTPS Tailscale *.ts.net or protected *.trycloudflare.com root URL.';
    liveVideoHint.className = 'global-live-hint error';
    return;
  }
  try { localStorage.setItem('rescuefusion_live_video_url', parsed.url); } catch {}
  liveVideoInput.value = parsed.url;
  labelVideoMode(parsed);
  liveVideoHint.textContent = parsed.isTailscale
    ? 'Opening the same private camera in a new tab (fallback if embedding is blocked).'
    : 'Opening protected video in a new tab. Sign in via Cloudflare OTP if required.';
  liveVideoHint.className = 'global-live-hint';
  window.open(parsed.url, '_blank', 'noopener,noreferrer');
};
liveVideoInput.addEventListener('input', () => {
  const parsed = normalizedProtectedVideoUrl(liveVideoInput.value);
  if (parsed) { labelVideoMode(parsed); liveVideoHint.className = 'global-live-hint'; }
});
liveVideoInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') $('watchGlobalVideo').click();
});

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
  } else {
    $('gpsTag').textContent = 'NO FRESH FIX'; $('gpsTag').className = 'tag';
    $('gpsValue').textContent = '—'; $('gpsExtra').textContent = `Waiting for fresh GPS fix · ${s.gps_sats ?? '—'} satellites`;
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
  drawPIR(s);
  drawBuzzer(s);
  drawDetection(data.ai_detection, s, gpsFresh, lat, lng);
}

function drawPIR(status) {
  if (!PIR_INSTALLED) {
    $('pirValue').textContent = 'PIR not installed yet';
    $('pirTag').textContent = 'NOT INSTALLED'; $('pirTag').className = 'tag';
    $('pirMeta').textContent = 'This sensor will be enabled after physical installation and telemetry testing.';
    return;
  }
  const raw = status.pir_motion ?? status.pir_detected ?? status.pir ?? null;
  const value = $('pirValue'), tag = $('pirTag'), meta = $('pirMeta');
  if (raw === null || raw === undefined || raw === '') {
    value.textContent = 'Waiting for PIR data';
    tag.textContent = 'NO DATA'; tag.className = 'tag';
    meta.textContent = 'PIR motion data is not present in the current telemetry stream.';
    return;
  }
  const normalized = String(raw).trim().toLowerCase();
  const active = raw === true || raw === 1 || ['true','1','on','motion','detected','active'].includes(normalized);
  const inactive = raw === false || raw === 0 || ['false','0','off','clear','none','inactive'].includes(normalized);
  if (!active && !inactive) {
    value.textContent = String(raw).slice(0,60);
    tag.textContent = 'PIR STATUS'; tag.className = 'tag';
    meta.textContent = 'PIR value received from telemetry.';
    return;
  }
  value.textContent = active ? 'Human motion detected' : 'No motion';
  tag.textContent = active ? 'MOTION' : 'CLEAR';
  tag.className = 'tag' + (active ? ' yellow' : ' green');
  meta.textContent = 'PIR indicates movement; camera AI is needed to classify a person or animal.';
}

function drawBuzzer(status) {
  const raw = status.buzzer;
  const on = raw === true || raw === 1 || ['true','1','on','active'].includes(String(raw).trim().toLowerCase());
  $('buzzerState').textContent = on ? 'Buzzer active' : 'Buzzer command unavailable';
  $('buzzerHint').textContent = on
    ? 'The current DevKit telemetry reports the buzzer as active.'
    : 'Button control will be enabled after the Arduino command path is implemented.';
  // Firebase is read-only in this browser; never pretend a click triggered hardware.
  $('buzzerButton').disabled = true;
}

function drawDetection(ai, status, gpsFresh, currentLat, currentLng) {
  const value = $('humanValue'), tag = $('humanTag'), meta = $('humanMeta');
  if (!ai || !Number(ai.updated_at_ms)) {
    value.textContent = 'Waiting'; tag.textContent = 'NO AI EVENT'; tag.className = 'tag';
    meta.textContent = 'Waiting for camera AI updates.';
    drawDetectionPin(gpsFresh, currentLat, currentLng);
    return;
  }
  const stamp = Number(ai.updated_at_ms);
  const ageMs = Date.now() - stamp;
  if (ageMs < -60000 || ageMs > 15000) {
    value.textContent = 'No recent detection'; tag.textContent = 'STALE'; tag.className = 'tag';
    meta.textContent = 'Last camera AI update is stale. Check the camera-to-PC bridge.';
    drawDetectionPin(gpsFresh, currentLat, currentLng);
    return;
  }
  if (ai.active !== true) {
    value.textContent = 'No object detected'; tag.textContent = 'CLEAR'; tag.className = 'tag green';
    meta.textContent = 'Camera AI checked the latest frame · updated ' + Math.max(0, Math.floor(ageMs / 1000)) + 's ago.';
    drawDetectionPin(gpsFresh, currentLat, currentLng);
    return;
  }
  const rawLabel = String(ai.label || 'OBJECT').trim();
  const displayLabel = rawLabel.toUpperCase();
  const subjects = rescueSubjects(rawLabel);
  if (subjects.length) recordRescueDetection(ai, subjects, gpsFresh, currentLat, currentLng);
  const confidence = Number(ai.confidence);
  value.textContent = displayLabel;
  tag.textContent = subjects.length ? 'LIVING SUBJECT' : 'OBJECT';
  tag.className = subjects.length ? 'tag green' : 'tag';
  meta.textContent = (Number.isFinite(confidence) ? 'Confidence ' + Math.round(confidence * 100) + '%' : 'Camera AI detection') +
    (subjects.length ? ' · person/animal event linked to GPS and the next newer cloud photo' : ' · no person/animal location or photo link') +
    ' · updated ' + Math.max(0, Math.floor(ageMs / 1000)) + 's ago.';
  drawDetectionPin(gpsFresh, currentLat, currentLng);
}

function recordRescueDetection(ai, subjects, gpsFresh, currentLat, currentLng) {
  const stamp = Number(ai.updated_at_ms);
  const signature = subjects.slice().sort().join(',');
  if (lastRescueEvent && lastRescueEvent.signature === signature && stamp-lastRescueEvent.lastSeenAt <= 20000) {
    lastRescueEvent.lastSeenAt = Math.max(stamp, lastRescueEvent.lastSeenAt);
    return;
  }
  const hasAIPosition = (ai.gps_lat != null && ai.gps_lng != null) || (ai.latitude != null && ai.longitude != null);
  const rawLat = hasAIPosition ? (ai.gps_lat ?? ai.latitude) : currentLat;
  const rawLng = hasAIPosition ? (ai.gps_lng ?? ai.longitude) : currentLng;
  const lat = Number(rawLat), lng = Number(rawLng);
  const hasLocation = (hasAIPosition || gpsFresh) && Number.isFinite(lat) && Number.isFinite(lng) && rawLat != null && rawLng != null;
  const label = subjects.map(x => x.toUpperCase()).join(', ');
  lastRescueEvent = {
    label, signature, lat: hasLocation ? lat : null, lng: hasLocation ? lng : null,
    hasLocation, aiUpdatedAt: stamp, lastSeenAt: stamp, snapshotAt: null
  };
  if (cloudFrame && cloudFrame.updated_at_ms > stamp) lastRescueEvent.snapshotAt = cloudFrame.updated_at_ms;
  updateCameraAge();
}

function drawDetectionPin(gpsFresh, currentLat, currentLng) {
  // Keep this browser-session pin; the dashboard does not write event data to Firebase.
  if (lastRescueEvent && !lastRescueEvent.hasLocation && gpsFresh &&
      Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
    lastRescueEvent.lat = currentLat; lastRescueEvent.lng = currentLng;
    lastRescueEvent.hasLocation = true;
  }
  if (lastRescueEvent?.hasLocation) {
    $('detectionLocation').textContent = `${lastRescueEvent.label} · ${lastRescueEvent.lat.toFixed(6)}, ${lastRescueEvent.lng.toFixed(6)}`;
    $('detectionLocationMeta').textContent = `Latest person/animal AI event · ${new Date(lastRescueEvent.aiUpdatedAt).toLocaleString()} · this session`;
  } else if (lastRescueEvent) {
    $('detectionLocation').textContent = `${lastRescueEvent.label} detected · waiting for GPS`;
    $('detectionLocationMeta').textContent = 'A valid current GPS fix will be attached when available.';
  } else {
    $('detectionLocation').textContent = 'No detection location recorded yet.';
    $('detectionLocationMeta').textContent = 'A person or animal AI event and a fresh GPS fix are needed.';
  }
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
      try { new Notification('MagmaFusion sensor event', {body: String(x.message).slice(0,180)}); } catch { /* browser may block */ }
    }
  }
  firstEvents=false; lastEventId=Math.max(lastEventId,highest);
}
function receiveLive(data) {
  if (!data || typeof data !== 'object') { lastLive=null; showWaiting(); return; }
  const session=data.status?.session_started_at ?? null;
  if (lastSession !== session) { lastSession=session; clearThrough=0; firstEvents=true; lastEventId=0; lastRescueEvent=null; }
  lastLive=data;
  drawStatus(data); drawLogs(data.output); drawEvents(data.events);
}
// If the bridge stops and Firebase no longer changes, stale data must not appear online.
setInterval(() => { if (lastLive && !$('siteShell').hidden) drawStatus(lastLive); }, 5000);
