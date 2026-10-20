/*
 * engine.js
 * Motor de cálculo do modo "A bordo" (GPS do celular, sem internet).
 * É a mesma lógica do app Windows, portada para JavaScript:
 *   - RailKm      <- railway_calc.py (projeta o GPS no traçado e acha o km oficial)
 *   - TripTracker <- schedule.py     (partida/chegada reais, atraso, previsão)
 * Os campos devolvidos por TripTracker.update() têm os MESMOS nomes dos campos que
 * o app Windows envia ao Firebase, então o painel usa o mesmo código de exibição
 * nos dois modos.
 */

// [nome, km oficial, chegada prevista "HH:MM" | null, partida prevista "HH:MM" | null]
const REAL_SCHEDULE = [
  ["Anjo da Guarda",      0.000, null,    "08:00"],
  ["Arari",             125.645, "10:09", "10:16"],
  ["Vitória do Mearim", 146.002, "10:37", "10:40"],
  ["Santa Inês",        212.429, "11:46", "11:56"],
  ["Alto Alegre",       264.192, "12:51", "12:56"],
  ["Mineirinho",        281.896, "13:16", "13:19"],
  ["Auzilândia",        299.060, "13:37", "13:40"],
  ["Altamira",          315.071, "13:59", "14:02"],
  ["Vila Pindaré",      334.756, "14:25", "14:30"],
  ["Nova Vida",         385.641, "15:21", "15:26"],
  ["Açailândia",        513.727, "17:31", "17:41"],
  ["São Pedro",         650.686, "19:54", "19:57"],
  ["Marabá",            736.600, "21:21", "21:31"],
  ["Itainópolis",       785.411, "22:19", "22:22"],
  ["Parauapebas",       861.583, "23:50", null],
];

// Sentido de volta (Parauapebas -> Anjo da Guarda). A coordenada de cada linha é o
// PROGRESSO ao longo da viagem (0 na saída), para a mesma lógica servir nos dois sentidos.
const TOTAL_KM = 861.583;
const VOLTA_TIMES = [ // [nome, chegada prevista, partida prevista]
  ["Parauapebas",       null,    "06:00"],
  ["Itainópolis",       "07:28", "07:31"],
  ["Marabá",            "08:19", "08:29"],
  ["São Pedro",         "09:53", "09:56"],
  ["Açailândia",        "12:09", "12:19"],
  ["Nova Vida",         "14:24", "14:29"],
  ["Vila Pindaré",      "15:20", "15:25"],
  ["Altamira",          "15:48", "15:51"],
  ["Auzilândia",        "16:10", "16:13"],
  ["Mineirinho",        "16:31", "16:34"],
  ["Alto Alegre",       "16:54", "16:59"],
  ["Santa Inês",        "17:54", "18:04"],
  ["Vitória do Mearim", "19:10", "19:13"],
  ["Arari",             "19:34", "19:41"],
  ["Anjo da Guarda",    "22:00", null],
];
const SCHEDULES = {
  ida: REAL_SCHEDULE,
  volta: VOLTA_TIMES.map(([n, c, p]) => [n, TOTAL_KM - REAL_SCHEDULE.find(r => r[0] === n)[1], c, p]),
};
const PREFIXOS = { ida: 'P-21', volta: 'P-22' };
const ROTULOS = { ida: 'Anjo da Guarda → Parauapebas', volta: 'Parauapebas → Anjo da Guarda' };
// escolha: 'auto' (pelo dia), 'P-21' (ida) ou 'P-22' (volta); aceita também 'ida'/'volta'
function resolverSentido(escolha, d){
  const e = String(escolha || 'auto').toLowerCase();
  if (e === 'p-21' || e === 'ida') return 'ida';
  if (e === 'p-22' || e === 'volta') return 'volta';
  return sentidoDoDia(d || new Date());
}
// seg/qui/sáb = ida; ter/sex/dom = volta; quarta (sem viagem) = ida
function sentidoDoDia(d){ return [2, 5, 0].includes(d.getDay()) ? 'volta' : 'ida'; }
// getDay(): dom=0 seg=1 ter=2 qua=3 qui=4 sex=5 sáb=6

// só prevê/atualiza a próxima estação depois de percorridos estes km desde a
// partida da estação anterior
const PREDICTION_START_KM = 2.0;
// na 1ª leitura, a estação mais recente só conta como "partida real" se o trem
// estiver a no máximo esta distância dela
const START_STATION_TOLERANCE_KM = 1.0;

// a partida da 1ª estação só é registrada quando o trem realmente se move esta
// distância desde o início do monitoramento (pode ficar parado e partir atrasado)
const ORIGIN_MOVE_KM = 0.2;

function formatKmBR(km){
  let totalM = Math.round(km * 1000);
  return Math.floor(totalM / 1000) + '+' + String(totalM % 1000).padStart(3, '0');
}

function parseHHMM(s){
  if (!s) return null;
  const [h, m] = s.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
function minutesOfDay(d){ return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }
function fmtHHMM(d){
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
// partida prevista (na última estação, sem partida, cai para a chegada)
function scheduledDeparture(row){ return row[3] || row[2]; }
// chegada prevista (na origem, sem chegada, cai para a partida)
function scheduledArrival(row){ return row[2] || row[3]; }

/* ---------------------------------------------------------------- km ---- */
class RailKm {
  // lat[], lon[], km[]: pontos do traçado em ordem, com o km oficial de cada um.
  constructor(lat, lon, km){
    this.lat = lat; this.lon = lon; this.km = km; this.n = lat.length;
  }

  // Projeta (lat, lon) no segmento mais próximo (aproximação planar local, como
  // no railway_calc.py) e interpola o km entre os dois pontos do segmento.
  locate(lat, lon){
    const K_LAT = 111.32;
    let bestD2 = Infinity, bestKm = 0, bestLat = lat, bestLon = lon;
    for (let i = 1; i < this.n; i++){
      const aLat = this.lat[i-1], aLon = this.lon[i-1];
      const bLat = this.lat[i],   bLon = this.lon[i];
      const kLon = K_LAT * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
      const ax = aLon * kLon, ay = aLat * K_LAT;
      const dx = bLon * kLon - ax, dy = bLat * K_LAT - ay;
      const px = lon * kLon - ax, py = lat * K_LAT - ay;
      const len2 = dx*dx + dy*dy;
      let t = len2 === 0 ? 0 : (px*dx + py*dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = px - t*dx, ey = py - t*dy;
      const d2 = ex*ex + ey*ey;
      if (d2 < bestD2){
        bestD2 = d2;
        bestKm = this.km[i-1] + t * (this.km[i] - this.km[i-1]);
        bestLat = aLat + t * (bLat - aLat);
        bestLon = aLon + t * (bLon - aLon);
      }
    }
    return { km: bestKm, offsetM: Math.sqrt(bestD2) * 1000, projLat: bestLat, projLon: bestLon };
  }
}

/* -------------------------------------------------------------- viagem -- */
class TripTracker {
  constructor(sentido){
    this.sentido = sentido === 'volta' ? 'volta' : 'ida';
    this.schedule = SCHEDULES[this.sentido];
    this.tripStart = null;       // Date da primeira leitura válida
    this.tripStartKm = null;
    this.originRefM = null;      // 1ª distância vista desde a estação (TP01/pátio)
    this.stationTimes = {};      // nome da estação -> Date em que o trem cruzou o km dela
  }

  // originDistM: distância (m) percorrida desde a estação pela TP01/pátio, quando o trem está
  // sobre eles (null na linha principal ou fora de ambos)
  update(currentKm, now, originDistM = null){
    // currentKm é o km oficial; internamente usa o progresso na viagem
    if (this.sentido === 'volta') currentKm = TOTAL_KM - currentKm;
    const REAL_SCHEDULE = this.schedule; // (sombra local: tabela do sentido atual)
    if (this.tripStart === null){
      this.tripStart = now;
      this.tripStartKm = currentKm;
    }

    // Registra a passagem pela estação (1ª vez que o km atual cruza o km oficial
    // dela). Na 1ª leitura, só a estação mais recente é candidata, e só é
    // registrada se o trem ainda estiver perto dela (START_STATION_TOLERANCE_KM);
    // se o monitoramento começou no meio do trecho, o horário dela é desconhecido
    // (fica sem horário em vez de receber um horário falso).
    const originName = REAL_SCHEDULE[0][0];
    if (this.sentido === 'ida' && originDistM !== null){
      if (this.originRefM === null) this.originRefM = originDistM;
      // partida real: estava a menos de 200 m do início e passou de 200 m (se o monitoramento
      // já começou depois disso, o horário é desconhecido)
      if (this.originRefM < ORIGIN_DEPARTURE_M && originDistM >= ORIGIN_DEPARTURE_M && !(originName in this.stationTimes))
        this.stationTimes[originName] = now;
    }
    const firstCall = Object.keys(this.stationTimes).length === 0;
    const passed = REAL_SCHEDULE.filter(r => r[1] <= currentKm);
    const toRecord = firstCall
      ? passed.slice(-1).filter(r => (r === REAL_SCHEDULE[0] ? this.tripStartKm : currentKm) - r[1] <= START_STATION_TOLERANCE_KM)
      : passed;
    for (const r of toRecord){
      if (r[0] === originName && (this.originRefM !== null || (currentKm - this.tripStartKm) < ORIGIN_MOVE_KM)) continue;
      if (!(r[0] in this.stationTimes)) this.stationTimes[r[0]] = now;
    }

    // estação anterior (última alcançada) / próxima
    let prevRow = null, nextRow = null;
    for (const row of REAL_SCHEDULE){
      if (row[1] <= currentKm) prevRow = row;
      else if (nextRow === null){ nextRow = row; break; }
    }
    const estacaoE_final = prevRow !== null && nextRow === null;

    // estação de origem do trecho (de onde o trem partiu para chegar na atual);
    // na 1ª estação não há anterior, então a "partida" é a dela própria.
    let origemRow = null;
    if (prevRow !== null){
      const i = REAL_SCHEDULE.indexOf(prevRow);
      origemRow = i > 0 ? REAL_SCHEDULE[i - 1] : null;
    }
    let estacaoOrigem = null, origemDt = null;
    if (origemRow !== null){
      estacaoOrigem = origemRow[0];
      origemDt = this.stationTimes[origemRow[0]] || null;
    } else if (prevRow !== null){
      estacaoOrigem = prevRow[0];
      origemDt = this.stationTimes[prevRow[0]] || null;
    }
    const partidaEstacaoOrigem = origemDt ? fmtHHMM(origemDt) : null;

    let chegadaEstacaoAtual = null;
    if (prevRow !== null && origemRow !== null){
      const dt = this.stationTimes[prevRow[0]];
      chegadaEstacaoAtual = dt ? fmtHHMM(dt) : null;
    }

    // atraso/adiantamento na última estação alcançada (PARTIDA real x prevista;
    // na última estação da linha, usa a CHEGADA)
    let partidaRealAnterior = null, atrasoMin = null;
    if (prevRow !== null){
      const dt = this.stationTimes[prevRow[0]];
      const sched = parseHHMM(scheduledDeparture(prevRow));
      if (dt){
        partidaRealAnterior = fmtHHMM(dt);
        if (sched !== null) atrasoMin = Math.round(minutesOfDay(dt) - sched);
      }
    }

    // velocidade média real desde o início do monitoramento
    const elapsedH = (now - this.tripStart) / 3600000;
    let avgSpeed = null;
    if (elapsedH > 1 / 3600 && currentKm > this.tripStartKm){
      avgSpeed = (currentKm - this.tripStartKm) / elapsedH;
    }

    // previsão de CHEGADA na próxima estação, pela velocidade média, só depois
    // de PREDICTION_START_KM desde a partida da estação anterior
    let chegadaPrevista = null, atrasoProximaMin = null;
    const distDesdePartida = prevRow ? currentKm - prevRow[1] : Infinity;
    if (nextRow && avgSpeed && avgSpeed > 0 && distDesdePartida >= PREDICTION_START_KM){
      const etaMin = (nextRow[1] - currentKm) / avgSpeed * 60;
      const eta = new Date(now.getTime() + etaMin * 60000);
      chegadaPrevista = fmtHHMM(eta);
      const sched = parseHHMM(scheduledArrival(nextRow));
      if (sched !== null) atrasoProximaMin = Math.round(minutesOfDay(eta) - sched);
    }

    return {
      sentido: this.sentido,
      prefixo: PREFIXOS[this.sentido],
      estacao_anterior: prevRow ? prevRow[0] : null,
      partida_real_anterior: partidaRealAnterior,
      atraso_min: atrasoMin,
      estacao_e_final: estacaoE_final,
      estacao_origem: estacaoOrigem,
      partida_estacao_origem: partidaEstacaoOrigem,
      chegada_estacao_atual: chegadaEstacaoAtual,
      proxima_estacao: nextRow ? nextRow[0] : null,
      velocidade_media_kmh: avgSpeed,
      chegada_prevista_proxima: chegadaPrevista,
      atraso_proxima_min: atrasoProximaMin,
    };
  }
}

/* ------------------------------------------------- filtro de leituras --- */
// Descarta leituras de GPS claramente erradas (longe da linha ou saltos
// impossíveis). Depois de várias rejeitadas seguidas, aceita a nova posição
// (re-sincroniza) para não travar caso o salto seja real.
class FixFilter {
  constructor(){ this.last = null; this.rejected = 0; }
  accept(loc, nowMs){
    if (loc.offsetM > 1500) return this._reject();
    if (this.last){
      const dtS = Math.max(0.5, (nowMs - this.last.t) / 1000);
      const maxJump = 1.0 + 0.05 * dtS;          // km (~180 km/h de folga)
      if (Math.abs(loc.km - this.last.km) > maxJump && this.rejected < 10) return this._reject();
    }
    this.rejected = 0;
    this.last = { km: loc.km, t: nowMs };
    return true;
  }
  _reject(){ this.rejected++; return false; }
}

/* ------------------------------------- TP01 e Pátio de Recepção -------- */
// Trechos de saída de Anjo da Guarda FORA da linha principal: a "Linha TP01" (1 km, da
// estação até o início do pátio) e o "Pátio de Recepção" (km 0 a 5+890, até o km 0 da EFC).
// Enquanto o trem estiver sobre um deles, o painel mostra o nome no lugar do km. Os pontos
// vêm do KML (lat, lon, em ordem); a posição ao longo de cada linha é dada em km.
const TP01_NAME = 'TP01';
const YARD_NAME = 'Pátio de Recepção';
const AREA_MAX_DIST_M = 150;
const ORIGIN_DEPARTURE_M = 200;   // a partida de Anjo da Guarda conta a partir de 200 m da estação
const TP01_POINTS = [[-2.567337, -44.331952], [-2.567604, -44.331102], [-2.56829, -44.330552], [-2.569186, -44.330463], [-2.570085, -44.330439], [-2.570975, -44.330543], [-2.571749, -44.331011], [-2.572592, -44.331258], [-2.57341, -44.330926], [-2.573923, -44.330199], [-2.574301, -44.329626]];   // 0 m, 100 m ... 1000 m
const YARD_POINTS = [[-2.574314, -44.329578], [-2.576497, -44.326061], [-2.579445, -44.32272], [-2.583192, -44.321675], [-2.588084, -44.320276], [-2.592051, -44.31933], [-2.596805, -44.317958], [-2.600792, -44.316955], [-2.605471, -44.315421], [-2.60948, -44.314318], [-2.614097, -44.312847], [-2.617902, -44.311747], [-2.621632, -44.310518]];   // km 0, 0,5 ... 5,89
const TP01_KM = TP01_POINTS.map((_, i) => i * 0.1);
const YARD_KM = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 5.89];

class Track {
  constructor(name, points, valuesM){ this.name = name; this.points = points; this.valuesM = valuesM; }
  // [distância até a linha em m, valor em m ao longo dela no ponto mais próximo]
  project(lat, lon){
    let best = [Infinity, 0];
    for (let i = 0; i < this.points.length - 1; i++){
      const a = this.points[i], b = this.points[i+1];
      const kLat = 111320, kLon = kLat * Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180);
      const ax = a[1]*kLon, ay = a[0]*kLat, bx = b[1]*kLon, by = b[0]*kLat;
      const px = lon*kLon, py = lat*kLat, dx = bx-ax, dy = by-ay, len2 = dx*dx + dy*dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / len2));
      const d = Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
      if (d < best[0]) best = [d, this.valuesM[i] + t * (this.valuesM[i+1] - this.valuesM[i])];
    }
    return best;
  }
}
class AreaLocator {
  constructor(tp01, yard){ this.tp01 = tp01; this.yard = yard; this.yardOffsetM = tp01.valuesM[tp01.valuesM.length - 1]; }
  // { name, distM } ou null: a área mais próxima, desde que mais perto dela que da linha
  // principal (no ponto de ligação com a EFC vale a linha principal)
  locate(lat, lon, mainOffsetM){
    const c = [];
    let [d, v] = this.tp01.project(lat, lon); c.push([d, this.tp01.name, v]);
    [d, v] = this.yard.project(lat, lon);      c.push([d, this.yard.name, this.yardOffsetM + v]);
    const ok = c.filter(x => x[0] <= AREA_MAX_DIST_M && x[0] < mainOffsetM - 5).sort((p, q) => p[0] - q[0]);
    return ok.length ? { name: ok[0][1], distM: ok[0][2] } : null;
  }
}
const AREAS = new AreaLocator(
  new Track(TP01_NAME, TP01_POINTS, TP01_KM.map(k => k * 1000)),
  new Track(YARD_NAME, YARD_POINTS, YARD_KM.map(k => k * 1000)));

if (typeof module !== 'undefined') module.exports = { AREAS, Track, AreaLocator, YARD_POINTS, TP01_POINTS, YARD_NAME, TP01_NAME, REAL_SCHEDULE, SCHEDULES, sentidoDoDia, resolverSentido, PREFIXOS, ROTULOS, RailKm, TripTracker, FixFilter, formatKmBR };
