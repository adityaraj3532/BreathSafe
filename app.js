const $=id=>document.getElementById(id);
const colors=['#69c486','#f1cf59','#f49a50','#ee6866','#b87bba','#b35977'];
const cats=['Good','Moderate','Sensitive groups','Unhealthy','Very unhealthy','Hazardous'];
const precautions = [
  ['Enjoy your usual walk, run or outdoor play.', 'Most people can follow their usual outdoor routine.'],
  ['Most people can continue their usual outdoor activities.', 'If pollution bothers you even at low levels, shorten intense exercise or take more breaks.'],
  ['Most people can continue ordinary outdoor activities.', 'Children, older adults and people with heart or lung conditions should shorten intense outdoor activities and take breaks.'],
  ['Take more breaks outdoors. Shorten strenuous activities such as running or football.', 'Move strenuous exercise indoors or reschedule it for a time with cleaner air.'],
  ['Keep outdoor activity brief. Move prolonged or intense exercise indoors.', 'Avoid outdoor physical activity. Choose an indoor activity or postpone it.'],
  ['Avoid outdoor physical activity. Wait for air quality to improve before exercising outside.', 'Stay indoors in cleaner air where possible. Follow local public-health advisories.']
];
function safetyStatus(title, detail) {
  $('alert-title').textContent = title;
  $('alert-detail').textContent = detail;
  $('alert-title').parentElement.style.setProperty('--severity', '#bbc9bf');
  $('precaution-context').textContent = detail;
  $('tips').hidden = true;
}
function showPrecautions(value, time) {
  const level = band(value);
  const label = level === 2 ? 'Unhealthy for sensitive groups' : cats[level];
  const location = $('place').textContent;
  if (!sample && (!Number.isFinite(time) || Math.abs(Date.now()/1000-time) > 3*3600)) {
    safetyStatus('Current alert unavailable', 'The estimate for '+location+' is out of date. Check the latest local advisory.');
    return;
  }
  const context = location+' · US AQI '+value+' · '+label;
  const title = sample ? 'Sample pollution outlook' : level >= 2 ? 'Pollution alert' : 'No elevated pollution alert';
  safetyStatus(title, context);
  $('alert-title').parentElement.style.setProperty('--severity', colors[level]);
  $('precaution-context').textContent = (sample ? 'Example precautions · ' : '')+context;
  $('advice').textContent = precautions[level][0];
  $('sensitive').textContent = precautions[level][1];
  $('tips').hidden = false;
}
const band=v=>[50,100,150,200,300,Infinity].findIndex(n=>v<=n);
const cities=[['Jaipur','India',26.9124,75.7873],['Delhi','India',28.61,77.21],['Mumbai','India',19.076,72.878],['Bengaluru','India',12.97,77.59],['London','United Kingdom',51.507,-.128]];
const cityZoom = 11;
let city=cities[0],version=0,searchVersion=0,zoom=cityZoom,hours=24,points=[],history=[],sample=false,center=null;
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(8500)});if(!r.ok)throw Error();return r.json()}
function api(lat,lon,extra){return 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude='+lat+'&longitude='+lon+'&current=us_aqi&timeformat=unixtime'+extra}
$('legend').innerHTML=cats.map((c,i)=>'<span><i style="background:'+colors[i]+'"></i>'+c+'</span>').join('');
const mapAttribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>';
const mapUnavailable = 'Some street map imagery is unavailable.';
const mapStatus = () => $('mapnote');

function loadStreetTile(img, {x, y, z}, onLoad, onError) {
  const resolution = window.devicePixelRatio > 1 ? '@2x' : '';
  img.alt = '';
  img.setAttribute('role', 'presentation');
  img.referrerPolicy = 'strict-origin-when-cross-origin';
  img.onload = onLoad;
  img.onerror = () => {
    img.onerror = onError;
    img.src = 'https://tile.openstreetmap.org/'+z+'/'+x+'/'+y+'.png';
  };
  img.src = 'https://basemaps.cartocdn.com/rastertiles/voyager/'+z+'/'+x+'/'+y+resolution+'.png';
}

let streetMap, markerLayer, mappedLocation, markerSignature, fallbackTileSignature;

function map() {
  const element = $('map');
  if (!element.clientWidth) return;
  if (!window.L) {
    fallbackMap();
    return;
  }
  if (!streetMap) {
    element.replaceChildren();
    const home = [city[2], city[3]];
    streetMap = L.map(element, {scrollWheelZoom: false, maxZoom: 19}).setView(home, cityZoom);
    mappedLocation = home.join(',');
    const StreetTiles = L.GridLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img');
        loadStreetTile(tile, coords, () => done(null, tile), () => {
          tile.style.visibility = 'hidden';
          done(new Error('Street tile unavailable'), tile);
        });
        return tile;
      }
    });
    const streets = new StreetTiles({attribution: mapAttribution, maxNativeZoom: 19});
    let missingTiles = 0;
    streets.on('loading', () => { missingTiles = 0; });
    streets.on('tileerror', () => { missingTiles++; });
    streets.on('load', () => { mapStatus().textContent = missingTiles ? mapUnavailable : ''; });
    mapStatus().textContent = '';
    streets.addTo(streetMap);
    L.control.scale({imperial: false}).addTo(streetMap);
    markerLayer = L.layerGroup().addTo(streetMap);

    const control = L.control({position: 'topright'});
    control.onAdd = () => {
      const box = L.DomUtil.create('div', 'leaflet-bar map-controls');
      const button = document.createElement('button');
      button.textContent = 'Recenter';
      button.type = 'button';
      button.onclick = () => {
        if (points.length > 1) {
          streetMap.fitBounds(points.map(([lat, lon]) => [lat, lon]), {padding: [34, 34], maxZoom: cityZoom});
        } else {
          streetMap.setView([city[2], city[3]], cityZoom);
        }
        if (missingTiles) streets.redraw();
      };
      box.append(button);
      L.DomEvent.disableClickPropagation(box);
      return box;
    };
    control.addTo(streetMap);
  }
  streetMap.invalidateSize({pan: false});
  const location = city.slice(2).join(',');
  if (location !== mappedLocation) {
    streetMap.setView([city[2], city[3]], cityZoom);
    mappedLocation = location;
  }
  const signature = JSON.stringify([location, points, sample]);
  if (signature === markerSignature) return;
  markerSignature = signature;
  markerLayer.clearLayers();
  for (const [lat, lon, value] of points) {
    const label = (sample ? 'Sample' : 'Estimated')+' US AQI '+value+' · '+cats[band(value)];
    const icon = L.divIcon({
      className: 'aq-marker',
      html: '<b style="background:'+colors[band(value)]+'">'+value+'</b>',
      iconSize: [42, 32],
      iconAnchor: [21, 16]
    });
    L.marker([lat, lon], {icon, title: label, alt: label})
      .bindPopup(label+'<br>'+lat.toFixed(3)+'°, '+lon.toFixed(3)+'°')
      .addTo(markerLayer);
  }
}

function world(lat, lon) {
  const size = 256 * 2**zoom;
  const radians = Math.min(85.05112878, Math.max(-85.05112878, lat)) * Math.PI / 180;
  return [(lon + 180) / 360 * size, (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size];
}

function fallbackMap() {
  const element = $('map');
  const [cx, cy] = world(city[2], city[3]);
  const left = cx - element.clientWidth / 2;
  const top = cy - element.clientHeight / 2;
  const tileCount = 2**zoom;
  const tiles = $('tiles');
  const signature = [zoom, left, top, element.clientWidth, element.clientHeight].join(',');
  if (signature !== fallbackTileSignature) {
    fallbackTileSignature = signature;
    tiles.replaceChildren();
    mapStatus().textContent = '';
    for (let x = Math.floor(left / 256); x <= Math.floor((left + element.clientWidth) / 256); x++) {
      for (let y = Math.floor(top / 256); y <= Math.floor((top + element.clientHeight) / 256); y++) {
        if (y < 0 || y >= tileCount) continue;
        const img = document.createElement('img');
        img.style.left = (x * 256 - left)+'px';
        img.style.top = (y * 256 - top)+'px';
        tiles.append(img);
        loadStreetTile(img, {x: (x % tileCount + tileCount) % tileCount, y, z: zoom}, null, () => {
          img.hidden = true;
          if (img.isConnected) mapStatus().textContent = mapUnavailable;
        });
      }
    }
  }

  const markers = $('markers');
  markers.replaceChildren();
  for (const [lat, lon, value] of points) {
    const [x, y] = world(lat, lon);
    const button = document.createElement('button');
    button.className = 'pin';
    const worldWidth = tileCount * 256;
    const nearestX = x + Math.round((cx - x) / worldWidth) * worldWidth;
    button.style.left = (nearestX - left)+'px';
    button.style.top = (y - top)+'px';
    button.style.background = colors[band(value)];
    button.textContent = value;
    button.title = (sample ? 'Sample' : 'Estimated')+' US AQI at '+lat.toFixed(2)+', '+lon.toFixed(2);
    button.onclick = () => { mapStatus().textContent = button.title+' · '+cats[band(value)]; };
    markers.append(button);
  }
}
function plot(){const data=history.slice(-hours),svg=$('plot');if(!data.length){svg.textContent='Hourly data unavailable.';$('summary').textContent='';return}const vals=data.map(p=>p[1]).filter(Number.isFinite);if(!vals.length){svg.textContent='Hourly data unavailable.';$('summary').textContent='';return}const max=Math.max(50,Math.ceil(Math.max(...vals)/50)*50),x=i=>38+360*i/Math.max(1,data.length-1),y=v=>128-104*v/max;let path='',pen=false;data.forEach((p,i)=>{if(!Number.isFinite(p[1])){pen=false;return}path+=(pen?'L':'M')+x(i)+' '+y(p[1]);pen=true});const ticks=[0,max/2,max].map(v=>'<path stroke="#dce6dc" d="M38 '+y(v)+'h360"/><text x="2" y="'+(y(v)+4)+'">'+v+'</text>').join('');const date=t=>new Date(t*1000).toLocaleString('en-GB',hours===24?{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}:{month:'short',day:'numeric',timeZone:'UTC'});svg.innerHTML='<svg viewBox="0 0 410 160" role="img" aria-label="Hourly US AQI trend" fill="#546d60" font-size="12">'+ticks+'<path d="'+path+'" stroke="#28754e" stroke-width="3" fill="none"/><text x="38" y="151">'+date(data[0][0])+'</text><text text-anchor="end" x="398" y="151">'+date(data.at(-1)[0])+' UTC</text></svg>';$('summary').textContent=(sample?'Sample range':'AQI range')+' · '+Math.min(...vals)+'–'+Math.max(...vals)+' over '+(hours===24?'24 hours':'7 days')}
function display(v,time){const i=band(v);$('aqi').textContent=v;$('category').textContent=i===2?'Unhealthy for sensitive groups':cats[i];$('category').style.background=colors[i];$('stamp').textContent=sample?'Sample data · live feed unavailable':(Math.abs(Date.now()/1000-time)>10800?'Delayed model estimate':'Current model estimate')+' · '+new Date(time*1000).toLocaleString();showPrecautions(v,time);explain(v,time);plot();map()}
async function load(c){const id=++version;city=c;resetTools();resetInsights();updateVisibility(c,id);points=[];history=[];sample=false;zoom=cityZoom;$('place').textContent=c.slice(0,2).filter(Boolean).join(', ');$('aqi').textContent='—';$('category').textContent='Loading';$('category').style.background='#eee';$('stamp').textContent='Retrieving current estimate…';safetyStatus('Checking pollution levels…','Waiting for a current estimate for '+$('place').textContent+'.');plot();map();
const offsets=[[0,0],[-.09,-.21],[.105,-.25],[.08,.23],[-.12,.21]],coords=offsets.map(([a,b])=>[Math.max(-89,Math.min(89,c[2]+a)),((c[3]+b+540)%360)-180]);
try{const d=await json(api(c[2],c[3],'&hourly=us_aqi,'+pollutants.map(p=>'us_aqi_'+p[0]).join(',')+'&past_days=31&forecast_days=4&timezone=auto'));if(id!==version)return;if(!Number.isFinite(d.current?.us_aqi))throw Error();const t=d.current.time,v=Math.round(d.current.us_aqi);history=(d.hourly?.time||[]).map((s,i)=>[s,d.hourly.us_aqi[i]]).filter(p=>p[0]<=t);prepareTools(d);showInsights(d);points=[[c[2],c[3],v]];display(v,t);try{const near=coords.slice(1),rows=await json(api(near.map(p=>p[0].toFixed(4)),near.map(p=>p[1].toFixed(4)),''));if(id!==version)return;rows.forEach((r,i)=>{if(Number.isFinite(r.current?.us_aqi))points.push([...near[i],Math.round(r.current.us_aqi)])});map()}catch{}}
catch{if(id!==version)return;if(c[0]==='Jaipur'&&Math.abs(c[2]-26.91)<.1){sample=true;const t=Math.floor(Date.now()/3600000)*3600;history=Array.from({length:168},(_,i)=>[t-(167-i)*3600,Math.round(115+28*Math.sin(i*.27)+10*Math.cos(i*.58))]);const v=history.at(-1)[1];points=coords.map((p,i)=>[...p,[v,92,134,159,109][i]]);display(v,t)}else{$('category').textContent='Unavailable';$('stamp').textContent='Live feed unavailable. Search again to retry.';safetyStatus('Current alert unavailable','Check local air-quality advisories for '+$('place').textContent+'.')}}}
$('plus').onclick=()=>{zoom=Math.min(15,zoom+1);map()};$('minus').onclick=()=>{zoom=Math.max(3,zoom-1);map()};document.querySelectorAll('[data-hours]').forEach(b=>b.onclick=()=>{hours=+b.dataset.hours;document.querySelectorAll('[data-hours]').forEach(a=>a.setAttribute('aria-pressed',a===b));plot()});
$('query').oninput=()=>{searchVersion++;$('results').replaceChildren()};$('search').onsubmit=async e=>{e.preventDefault();const q=$('query').value.trim(),id=++searchVersion;if(!q)return;const box=$('results');box.textContent='Searching…';let matches=cities.filter(c=>c[0].toLowerCase().includes(q.toLowerCase()));function show(list){if(id!==searchVersion)return;box.replaceChildren();for(const c of list){const b=document.createElement('button');b.type='button';b.textContent=c.slice(0,2).filter(Boolean).join(', ');b.onclick=()=>{searchVersion++;box.replaceChildren();$('query').value='';load(c)};box.append(b)}}if(matches.length)show(matches);try{const d=await json('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&name='+encodeURIComponent(q));if(id!==searchVersion)return;const list=(d.results||[]).map(r=>[r.name,[r.admin1,r.country].filter(Boolean).join(', '),r.latitude,r.longitude]);if(list.length)show(list);else if(!matches.length)box.textContent='No matching location.'}catch{if(id===searchVersion&&!matches.length)box.textContent='Location search offline. Try Jaipur or Delhi.'}};
function art(){const el=$('contours'),w=el.width=el.clientWidth,h=el.height=el.clientHeight,ctx=el.getContext('2d');ctx.strokeStyle='rgba(186,221,156,.23)';for(let i=0;i<53;i++){ctx.beginPath();for(let j=0;j<=480;j++){const a=j*Math.PI/240,r=(i+3)*(1+.14*Math.sin(3*a+i*.018)+.09*Math.cos(5*a));const x=w*.69+Math.cos(a)*r*6,y=h*.66+Math.sin(a)*r*3.5;j?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}}
new ResizeObserver(()=>{art();map()}).observe($('map'));load(cities[0]);

$('locate').onclick = () => {
  const status = $('geo-status');
  if (!navigator.geolocation) {
    status.textContent = 'Location unavailable. Search for your city above.';
    return;
  }
  const request = ++searchVersion;
  $('results').replaceChildren();
  status.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(({coords}) => {
    if (request !== searchVersion) return;
    status.textContent = '';
    const lat = Number(coords.latitude.toFixed(2)), lon = Number(coords.longitude.toFixed(2));
    load(['Your location', lat+'°, '+lon+'°', lat, lon]);
  }, () => {
    if (request === searchVersion) status.textContent = 'Location unavailable. Search for your city above.';
  }, {timeout:12000, maximumAge:300000});
};
$('query').addEventListener('input', () => { $('geo-status').textContent = ''; });
setInterval(() => { if (!document.hidden) load(city); }, 15*60*1000);

async function updateVisibility(location, request) {
  const line = $('visibility');
  line.textContent = 'Checking visibility…';
  try {
    const params = new URLSearchParams({
      latitude: location[2], longitude: location[3],
      hourly: 'visibility', timeformat: 'unixtime', forecast_days: '2'
    });
    const data = await json('https://api.open-meteo.com/v1/forecast?' + params);
    if (request !== version) return;
    const hour = Math.floor(Date.now() / 3600000) * 3600;
    const metres = data.hourly.visibility[data.hourly.time.indexOf(hour)];
    if (!Number.isFinite(metres) || metres < 0) throw Error();
    line.textContent = 'Estimated visibility · ' + (metres / 1000).toFixed(1) + ' km';
  } catch {
    if (request === version) line.textContent = 'Visibility estimate unavailable';
  }
}

const leafletCSS=document.createElement('link');
leafletCSS.rel='stylesheet';
leafletCSS.href='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
leafletCSS.onload=()=>{
  const script=document.createElement('script');
  script.src='https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
  script.onload=map;
  document.head.append(script);
};
document.head.append(leafletCSS);
