import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getDatabase,ref,onValue} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
const firebaseConfig = {
  apiKey: 'AIzaSyBo_O0p6p_7yNUK5al47JAT-e7m2AImmZk',
  authDomain: 'rescuefusion.firebaseapp.com',
  databaseURL: 'https://rescuefusion-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'rescuefusion',
  storageBucket: 'rescuefusion.firebasestorage.app',
  messagingSenderId: '178684140045',
  appId: '1:178684140045:web:7436750276f1bfafbb1344'
};

const db=getDatabase(initializeApp(firebaseConfig));
let data=null,failed=false;
const $=id=>document.getElementById(id);
function draw(){
 const stamp=Number(data?.updated_at_ms),age=Date.now()-stamp;
 const fresh=data?.schema_version===1&&Number.isFinite(stamp)&&age>=-5000&&age<30000;
 const online=fresh&&data.online===true;
 $('connection').textContent=failed?'Public data unavailable — access is not enabled or the connection failed.':!fresh?'No fresh public update':online?'Robot online':'Robot offline';
 const temp=data?.temperature_c,gas=data?.mq7_raw;
 $('temperature').textContent=online&&typeof temp==='number'&&Number.isFinite(temp)?temp.toFixed(2)+' °C':'—';
 $('gas').textContent=online&&typeof gas==='number'&&Number.isFinite(gas)?String(gas):'—';
 $('tilt').textContent=online&&typeof data.tilt_detected==='boolean'?(data.tilt_detected?'Tilt detected':'Level'):'—';
 $('updated').textContent=Number.isFinite(stamp)?'Last published: '+new Date(stamp).toLocaleString():'';
}
onValue(ref(db,'robots/rescuefusion/public_live'),snap=>{data=snap.val();failed=false;draw();},()=>{data=null;failed=true;draw();});
setInterval(draw,2000);
