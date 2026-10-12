'use strict';
const $ = (id) => document.getElementById(id);
const IS_GITHUB_PAGES = location.hostname.toLowerCase().endsWith('.github.io');
let lastSeq = 0, entries = [], lastEventID = 0, initialized = false, notificationsOn = false, requestedCam = false;
const MAX_LINES = 750;
const validIP = (s) => {const parts=s.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255);};
const formatTime = seconds => {if(!Number.isFinite(seconds)||seconds<0)return '—'; let n=Math.floor(seconds);return `${Math.floor(n/3600)}h ${String(Math.floor((n%3600)/60)).padStart(2,'0')}m ${String(n%60).padStart(2,'0')}s`;};
function cameraConnect(){
  const ip=$('cameraIP').value.trim();
  if(!validIP(ip)){$('streamNote').textContent='Enter a valid camera IPv4 address, e.g. 192.168.0.101';return;}
  localStorage.setItem('rescuefusion_cam_ip',ip);
  $('streamBadge').textContent='CONNECTING'; $('streamNote').textContent=`Trying http://${ip}/sustain?stream=0`;
  $('cameraPlaceholder').textContent='Connecting to ESP32-CAM stream...'; $('cameraPlaceholder').hidden=false;
  const img=$('cameraStream');img.hidden=true;requestedCam=true;
  $('openCam').hidden=false;$('openCam').href=`http://${ip}/`;
  if(location.protocol==='https:'){
    $('streamBadge').textContent='LOCAL ONLY';
    $('streamNote').textContent='HTTPS website cannot embed the local HTTP camera stream';
    $('cameraPlaceholder').textContent='ESP32-CAM runs on your local Wi-Fi. Use “Open camera webpage” while connected to the same network. Remote streaming needs a secure relay.';
    return;
  }
  img.onload=()=>{img.hidden=false;$('cameraPlaceholder').hidden=true;$('streamBadge').textContent='LIVE';$('streamNote').textContent=`MJPEG2SD stream · ${ip}`;};
  img.onerror=()=>{img.hidden=true;$('cameraPlaceholder').hidden=false;$('cameraPlaceholder').textContent='Stream not available at this endpoint. Use “Open camera webpage” to check live video.';$('streamBadge').textContent='STREAM ERROR';$('streamNote').textContent='Check camera power, current IP, and Wi-Fi';};
  img.src=`http://${ip}/sustain?stream=0&_=${Date.now()}`;
}
$('connectCam').onclick=cameraConnect;
$('cameraIP').addEventListener('keydown',e=>{if(e.key==='Enter')cameraConnect();});
$('cameraIP').value=localStorage.getItem('rescuefusion_cam_ip')||'';
$('notifyBtn').onclick=async()=>{
  if(!('Notification' in window)){$('notifyBtn').textContent='Notifications unavailable';return;}
  const permission=await Notification.requestPermission();
  notificationsOn=permission==='granted';
  $('notifyBtn').textContent=notificationsOn?'Notifications enabled':'Notifications blocked';
};
$('autoScroll').checked=true;
$('clearOutput').onclick=()=>{entries=[];lastSeq=Number(lastSeq)||0;$('serialOutput').replaceChildren();$('lineCount').textContent='0 lines (view cleared)';};
$('copyOutput').onclick=async()=>{const text=entries.map(x=>`[${x.time}] ${x.text}`).join('\n');try{await navigator.clipboard.writeText(text);$('copyOutput').textContent='Copied';setTimeout(()=>$('copyOutput').textContent='Copy output',1100);}catch(e){$('copyOutput').textContent='Copy unavailable';}};
function updateSnapshot(s,now){
  const live=s.serial_connected&&s.last_line_at&&(now-s.last_line_at)<15;
  const badge=$('onlineBadge'); badge.className='pill '+(s.demo?'demo':live?'online':'offline');
  badge.lastElementChild.textContent=s.demo?'DEMO · no robot':live?'DevKit online':'DevKit offline';
  $('portName').textContent=`${s.port||'COM4'} · 115200 baud`;
  $('topHint').textContent=s.demo?'Synthetic data only':live?'Local serial data updating':s.serial_error?`Serial: ${s.serial_error}`:'Waiting for DevKit data';
  $('outputStatus').textContent=s.demo?'DEMO mode — generated lines are not real measurements':live?'Read-only live copy of ESP32 DevKit serial messages':'Serial offline — close Arduino Serial Monitor / check COM port';
  if(s.gps_valid&&s.gps_lat!==null&&s.gps_lng!==null&&s.gps_seen_at&&now-s.gps_seen_at<10){
    $('gpsTag').textContent='VALID FIX';$('gpsTag').className='tag green';
    $('gpsValue').textContent=`${s.gps_lat.toFixed(6)}, ${s.gps_lng.toFixed(6)}`;
    $('gpsExtra').textContent=`Robot GPS position · ${s.gps_sats??'?'} satellites`;
    $('mapLink').hidden=false;$('mapLink').href=`https://www.google.com/maps?q=${s.gps_lat},${s.gps_lng}`;
  }else{$('gpsTag').textContent='NO FRESH FIX';$('gpsTag').className='tag';$('gpsValue').textContent='—';$('gpsExtra').textContent=`Waiting for fresh fix · satellites: ${s.gps_sats??'—'}`;$('mapLink').hidden=true;}
  $('obstacleValue').textContent=s.front_cm==null?'—':s.front_cm.toFixed(1);
  $('obstacleTag').textContent=s.front_cm==null?'NO DATA':s.front_cm<=20?'NEAR':'CLEAR';
  $('obstacleTag').className='tag '+(s.front_cm!=null&&s.front_cm<=20?'red':'');
  $('gasValue').textContent=s.mq7_raw??'—';$('gasTag').textContent=s.buzzer?'ALERT':'RAW ADC';$('gasTag').className='tag '+(s.buzzer?'red':'');
  $('cameraValue').textContent=s.camera_last_http===null?'—':`HTTP ${s.camera_last_http}`;
  $('cameraTag').textContent=s.camera_last_http===null?'NOT TESTED':s.camera_last_http===200?'LAST OK':'LAST FAILED';
  $('cameraTag').className='tag '+(s.camera_last_http===200?'green':s.camera_last_http!=null?'red':'');
  $('uptimeValue').textContent=s.session_started_at&&s.serial_connected?formatTime(now-s.session_started_at):'—';
  $('upTag').textContent=s.demo?'DEMO':'LOCAL';
  $('humanValue').textContent='Waiting';
}
function addLogs(logs){
  const terminal=$('serialOutput');
  if(!logs.length)return;
  if(terminal.querySelector('.placeholder-log'))terminal.replaceChildren();
  const frag=document.createDocumentFragment();
  for(const item of logs){
    entries.push(item);const div=document.createElement('div');
    const text=item.text; div.className='log-line'+(/\bWARN\b|\bERROR\b|\bSTOP:|\bBLOCKED\b|\bFAULT\b|HTTP: -\d+/.test(text)?' warn':/HTTP:\s*200|MOTOR FORWARD|WiFi connected/i.test(text)?' good':'');
    const ts=document.createElement('span');ts.className='log-ts';ts.textContent=`[${item.time}]`;
    div.appendChild(ts);div.appendChild(document.createTextNode(text));frag.appendChild(div);
  }
  terminal.appendChild(frag);
  while(entries.length>MAX_LINES){entries.shift();terminal.firstElementChild?.remove();}
  $('lineCount').textContent=`${entries.length} lines shown`;
  if($('autoScroll').checked)terminal.scrollTop=terminal.scrollHeight;
}
function displayEvents(eventList){
  $('eventCount').textContent=`${eventList.length} recent events`;
  const host=$('events');host.replaceChildren();
  if(eventList.length===0){const p=document.createElement('p');p.className='help';p.textContent='Events will appear as sensor thresholds or robot states change.';host.appendChild(p);return;}
  for(const item of eventList.slice(0,14)){
    const e=document.createElement('div');e.className=`event ${item.kind}`;
    const ts=document.createElement('span');ts.className='event-time';ts.textContent=item.time;
    const msg=document.createElement('span');msg.className='event-message';msg.textContent=item.message;
    e.append(ts,msg);host.appendChild(e);
  }
  if(initialized&&notificationsOn){
    for(const item of eventList.slice().reverse().filter(x=>x.id>lastEventID&&x.kind==='warning')){
      try{new Notification('RescueFusion Alert',{body:item.message});}catch(e){}
    }
  }
  lastEventID=Math.max(lastEventID,...eventList.map(x=>x.id),0);
}
let busy=false;
async function poll(){
  if(busy)return;busy=true;
  try{
    const response=await fetch(`./api/poll?after=${lastSeq}`,{cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const data=await response.json();
    updateSnapshot(data.state,data.server_at);
    addLogs(data.logs);
    displayEvents(data.events);
    lastSeq=data.last_seq;
    initialized=true;
  }catch(e){$('onlineBadge').className='pill offline';$('onlineBadge').lastElementChild.textContent='Dashboard server offline';$('topHint').textContent='Cannot reach local Python server';}
  finally{busy=false;}
}
function showCloudPending(){
  $('onlineBadge').className='pill offline';
  $('onlineBadge').lastElementChild.textContent='CLOUD NOT CONNECTED';
  $('topHint').textContent='GitHub Pages is online. Firebase live telemetry is not connected yet.';
  $('outputTag').textContent='CLOUD PENDING';
  $('portName').textContent='REMOTE · NO USB ACCESS';
  $('outputStatus').textContent='Live Arduino output requires the upcoming PC-to-Firebase bridge.';
  $('serialOutput').replaceChildren();
  const message=document.createElement('div');
  message.className='placeholder-log';
  message.textContent='Your website is published successfully. Remote live logs, GPS and sensors will appear here after Firebase is configured and the PC bridge is running. For live USB readings now, continue using http://127.0.0.1:8765 on the connected PC.';
  $('serialOutput').appendChild(message);
  $('notifyBtn').disabled=true;
  $('notifyBtn').textContent='Cloud alerts pending';
}
if(IS_GITHUB_PAGES){showCloudPending();}
else{poll();setInterval(poll,900);}
