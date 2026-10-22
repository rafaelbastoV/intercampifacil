/* =============================================================
   Intercampi Fácil — app.js
   SPA leve: Home (próximas viagens) · Linhas · Rota no mapa
   Dados sempre vindos de horarios_intercampi.json
   ============================================================= */

(function () {
  'use strict';

  var STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
  var STYLE_URL_DARK = 'https://tiles.openfreemap.org/styles/dark';
  var THEME_KEY = 'icf-theme';

  /* ---------- Referências do DOM ---------- */
  function $(id) { return document.getElementById(id); }

  var views = { home: $('view-home'), linhas: $('view-linhas'), rota: $('view-rota') };
  var navItems = [].slice.call(document.querySelectorAll('.nav-item'));

var tripsList = $('trips-list');
var tripsCount = $('trips-count');
var emCursoSection = $('em-curso-section');
var emCursoList = $('em-curso-list');
var emCursoCount = $('em-curso-count');
var linhasList = $('linhas-list');
var linhasCount = $('linhas-count');

  var originInput = $('origin');
  var destInput = $('destination');
  var destSuggest = $('dest-suggest');
  var nextTripCard = $('next-trip-card');
  var locateBtn = $('locate-btn');
  var swapBtn = $('swap-btn');
  var modal = $('trip-modal');
  var modalContent = $('modal-content');

  /* ---------- Estado ---------- */
  var homeMap = null;
  var rotaMap = null;
  var userMarker = null;
  var destMarker = null;
  var currentView = 'home';

  var lines = [];
  var periods = [];
  var loadError = false;

  var stopNames = [];
  var destStopName = null;
  var nextTripSig = null;
  var homeRouteMarkers = [];
  var homeRouteToken = 0;

  var homeTripMarkers = [];
  var homeTripSourceIds = [];
  var homeTripsSig = null;
  var homeTripsToken = 0;

  var busMarker = null;
  var busTrip = null;
  var busRafId = 0;
  var busLogAt = 0;

  var emCursoTimer = 0;
  var emCursoSig = null;
  var homeTimer = 0;

  var rotaLineId = null;

  var toastEl = null;

  /* =============================================================
     Utilitários
     ============================================================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toMin(t) {
    var p = String(t || '').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }

  function normalize(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripParens(s) {
    return String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function busIconSVG(size) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="' +
      size + '" height="' + size + '" aria-hidden="true">' +
      '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>' +
      '<path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>' +
      '<circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>' +
      '</svg>'
    );
  }

  function clockIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  }

  function pinIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  }

  function chevronIcon(cls) {
    return '<svg class="' + (cls || 'trip-chevron') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  }

  function withIcon(svg, text) {
    return '<span class="trip-time">' + svg + '<span>' + esc(text) + '</span></span>';
  }

  function busColorClass(cor) {
    return cor === 'orange' ? 'bus-orange' : cor === 'maroon' ? 'bus-maroon' : 'bus-blue';
  }

  /* =============================================================
     Relógio — fonte única de verdade
     CLOCK_MODE = 'simulated' arranca em SIMULATED_START_TIME e
     avança em tempo real. Troque para 'real' para usar a hora do
     dispositivo; nada mais precisa mudar.
     ============================================================= */
  var CLOCK_MODE = 'real';
  var SIMULATED_START_TIME = '20:45';
  var DAY_MS = 86400000;

  var clockAnchorRealMs = null;
  var clockAnchorSimMs = null;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* 00:00 do dia corrente no fuso local, em ms */
  function localDayStartMs(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  /* "dia relativo + HH:MM" -> ms no fuso local (respeita meia-noite e DST) */
  function localTimeMs(dayStartMs, dayOffset, minOfDay) {
    var d = new Date(dayStartMs);
    if (dayOffset) d.setDate(d.getDate() + dayOffset);
    d.setHours(0, minOfDay, 0, 0);
    return d.getTime();
  }

  function resetClockAnchor() {
    clockAnchorRealMs = Date.now();
    clockAnchorSimMs = localTimeMs(localDayStartMs(clockAnchorRealMs), 0, toMin(SIMULATED_START_TIME));
  }

  /* Milissegundos corridos no domínio do relógio (monótono) */
  function getClockMs() {
    if (CLOCK_MODE === 'real') return Date.now();
    if (clockAnchorRealMs === null) resetClockAnchor();
    return clockAnchorSimMs + (Date.now() - clockAnchorRealMs);
  }

  function getSimulatedTime() {
    var d = new Date(getClockMs());
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function clockDayStartMs() {
    return localDayStartMs(getClockMs());
  }

  /* =============================================================
     Processamento dos dados do JSON
     ============================================================= */
  function lineTitle(nome) {
    var up = normalize(nome);
    if (up.indexOf('nova iguacu') !== -1) return 'Linha Nova Iguaçu';
    if (up.indexOf('campo grande') !== -1) return 'Linha Campo Grande';
    if (up.indexOf('especial') !== -1) return 'Ônibus Especial (Almoço)';
    return String(nome || '').replace(/^ÔNIBUS\s+URBANO\s*/i, 'Linha Urbano ').trim();
  }

  function lineColor(nome) {
    var up = normalize(nome);
    if (up.indexOf('nova iguacu') !== -1) return 'orange';
    if (up.indexOf('campo grande') !== -1) return 'maroon';
    return 'blue';
  }

  function shortPartida(local) {
    var m = /Campus\s+\d+\s+(.+)$/i.exec(String(local || '').trim());
    if (m && m[1]) return m[1].split(' - ')[0].trim();
    return String(local || '').trim() || 'Campus';
  }

  function campusLabel(local) {
    var m = /Campus\s+\d+\s+([A-Za-zÀ-úÉé]+)/.exec(String(local || ''));
    return m ? 'Campus ' + m[1] : String(local || '');
  }

  function lineDest(raw) {
    var up = normalize(raw.nome);
    if (up.indexOf('nova iguacu') !== -1) return 'Baixada Fluminense';
    if (up.indexOf('campo grande') !== -1) return 'Zona Oeste';
    var paradas = raw.paradas || [];
    var last = paradas[paradas.length - 1];
    return last ? (stripParens(last.nome) || last.nome) : shortPartida(raw.partida.local);
  }

  /* Percurso completo do trajeto: o local de partida (partida.local) seguido das
     paradas. Sem a partida, o traçado no mapa começa na primeira parada e a perna
     de saída do campus nunca é desenhada. */
  function buildRoutePoints(raw, paradas) {
    var depKey = matchCoordKey(normalize(raw.partida.local));
    var firstKey = paradas.length ? matchCoordKey(normalize(paradas[0].nome)) : null;
    var pontos = [];
    if (!(depKey && depKey === firstKey)) {
      pontos.push({
        nome: raw.partida.local,
        hora: raw.partida.horario,
        ordem: 0,
        partida: true
      });
    }
    paradas.forEach(function (p) {
      pontos.push({ nome: p.nome, hora: p.hora, ordem: p.ordem, partida: false });
    });
    return pontos;
  }

  function buildFromData(data) {
    lines = [];
    periods = [];
    (data.periodos || []).forEach(function (period, pi) {
      var items = [];
      (period.linhas || []).forEach(function (raw, li) {
        var paradas = (raw.paradas || []).map(function (p) {
          return { nome: p.nome, hora: p.horarioEstimado, ordem: p.ordem };
        });
        var pontos = buildRoutePoints(raw, paradas);
        var last = paradas[paradas.length - 1];
        var chegada = raw.retorno && raw.retorno.horario
          ? raw.retorno.horario
          : (last ? last.hora : raw.partida.horario);
        var dur = toMin(chegada) - toMin(raw.partida.horario);
        if (dur < 0) dur += 1440;

        items.push({
          id: pi + '-' + li,
          period: period.periodo,
          nome: raw.nome,
          partidaLocal: raw.partida.local,
          partida: raw.partida.horario,
          chegada: chegada,
          retorno: raw.retorno || null,
          novoHorario: !!raw.novoHorario,
          duracao: dur,
          paradas: paradas,
          pontos: pontos,
          origem: shortPartida(raw.partida.local),
          destino: lineDest(raw),
          titulo: lineTitle(raw.nome),
          cor: lineColor(raw.nome),
          campus: campusLabel(raw.partida.local)
        });
      });
      periods.push({ periodo: period.periodo, linhas: items });
      lines = lines.concat(items);
    });
    buildStopList();
  }

  /* Pontos de parada disponíveis no JSON (partida + paradas), sem repetir.
     É a única lista aceita no campo "Para onde vou". */
  function buildStopList() {
    var seen = {};
    stopNames = [];
    lines.forEach(function (l) {
      l.pontos.forEach(function (p) {
        if (!seen[p.nome]) {
          seen[p.nome] = true;
          stopNames.push(p.nome);
        }
      });
    });
    stopNames.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  function findStopByName(value) {
    var q = normalize(value);
    if (!q) return null;
    for (var i = 0; i < stopNames.length; i++) {
      if (normalize(stopNames[i]) === q) return stopNames[i];
    }
    return null;
  }

  /* =============================================================
     Próximas viagens (Home)
     ============================================================= */
  function nextTrips(n) {
    var nowMin = toMin(getSimulatedTime());
    var LOOKBACK = 60;

    var candidates = lines.map(function (l) {
      var dep = toMin(l.partida);
      var off = dep - nowMin;
      var isTomorrow = false;
      if (off < -LOOKBACK) { off += 1440; isTomorrow = true; }
      else if (off < 0) { off = 0; }
      return { line: l, off: off, isTomorrow: isTomorrow };
    });

    candidates.sort(function (a, b) {
      if (a.off !== b.off) return a.off - b.off;
      return a.line.partida.localeCompare(b.line.partida) || a.line.id.localeCompare(b.line.id);
    });

    return candidates.slice(0, n);
  }

  function renderTripCard(t) {
    var l = t.line;
    var plural = l.paradas.length === 1 ? ' parada' : ' paradas';
    return (
      '<a class="trip-card" href="#/rota/' + esc(l.id) + '">' +
        '<div class="bus-icon ' + busColorClass(l.cor) + '" aria-hidden="true">' + busIconSVG(25) + '</div>' +
        '<div class="trip-info">' +
          '<h3 class="trip-title">' + esc(l.titulo) + '</h3>' +
          '<p class="trip-route">' + esc(l.origem) + ' → ' + esc(l.destino) + '</p>' +
          '<div class="trip-times">' +
            withIcon(clockIcon(), 'Saída ' + l.partida) +
            withIcon(pinIcon(), 'Chegada ' + l.chegada) +
          '</div>' +
          '<div class="trip-meta">' +
            '<span>' + l.paradas.length + plural + '</span>' +
            '<span>' + esc(l.campus) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="trip-side">' +
          '<span class="trip-badge">' + l.duracao + ' min</span>' +
          chevronIcon() +
        '</div>' +
      '</a>'
    );
  }

  function renderHome() {
    renderEmCurso();
    if (loadError) {
      tripsCount.textContent = '—';
      tripsList.innerHTML =
        '<div class="trips-empty">Não foi possível carregar os horários.<br/>' +
        'Abra a página através de um servidor HTTP<br/>(ex.: <strong>python -m http.server</strong>).' +
        '</div>';
      return;
    }
    var picks = nextTrips(2);
    tripsCount.textContent = picks.length === 1 ? '1 viagem' : picks.length + ' viagens';
    if (!picks.length) {
      tripsList.innerHTML = '<div class="trips-empty">Nenhuma viagem encontrada para o horário atual.</div>';
      return;
    }
    tripsList.innerHTML = picks.map(renderTripCard).join('');
  }

  /* =============================================================
     Ônibus em curso (Home)
     Mesmas linhas da aba Linhas, mas só as que estão percorrendo
     o itinerário neste instante do relógio. O recorte reaproveita
     tripWindow(), que já resolve meia-noite e o dia corrente.
     ============================================================= */
  function ongoingLines() {
    var nowMs = getClockMs();
    return lines.filter(function (l) {
      var w = tripWindow({ pontos: l.pontos }, nowMs);
      return !!w && w.active;
    });
  }

  function renderEmCurso() {
    if (!emCursoList) return;
    if (loadError || !lines.length) {
      emCursoSig = null;
      emCursoSection.hidden = true;
      return;
    }
    emCursoSection.hidden = false;

    var ongoing = ongoingLines();
    var sig = ongoing.map(function (l) { return l.id; }).join(',');
    if (sig === emCursoSig) return;   /* nada mudou: não mexe no DOM */
    emCursoSig = sig;

    emCursoCount.textContent = !ongoing.length
      ? 'nenhum'
      : ongoing.length === 1 ? '1 em curso' : ongoing.length + ' em curso';

    emCursoList.innerHTML = ongoing.length
      ? ongoing.map(renderLinhaCard).join('')
      : '<div class="trips-empty">Nenhum ônibus em curso neste horário.</div>';
  }

  /* A lista envelhece sozinha: o relógio segue andando enquanto a Home
     está visível. Fora dela o timer é desligado, como o mapa da rota. */
  function startEmCursoWatch() {
    if (emCursoTimer) return;
    emCursoTimer = setInterval(renderEmCurso, 15000);
  }

  function stopEmCursoWatch() {
    if (!emCursoTimer) return;
    clearInterval(emCursoTimer);
    emCursoTimer = 0;
  }

  /* =============================================================
     Home — atualização periódica
     O relógio segue andando enquanto a Home está visível: o card do
     destino e as rotas padrão do mapa são reavaliados a cada 15s.
     Fora da Home o timer é desligado.
     ============================================================= */
  function startHomeWatch() {
    if (homeTimer) return;
    homeTimer = setInterval(function () {
      refreshNextTrip();
      renderHomeTrips();
      renderDefaultRoute();
    }, 15000);
  }

  function stopHomeWatch() {
    if (!homeTimer) return;
    clearInterval(homeTimer);
    homeTimer = 0;
  }

  /* =============================================================
     Página de Linhas
     ============================================================= */
  function renderLinhas() {
    linhasCount.textContent = loadError
      ? 'Erro ao carregar os dados'
      : lines.length === 1 ? '1 linha hoje' : lines.length + ' linhas hoje';

    if (loadError || !lines.length) {
      linhasList.innerHTML =
        '<div class="linhas-empty">' +
        (loadError
          ? 'Não foi possível carregar <strong>horarios_intercampi.json</strong>.<br/>Sirva a página por HTTP.'
          : 'Nenhuma linha disponível.') +
        '</div>';
      return;
    }

    linhasList.innerHTML = periods.map(function (period) {
      var plural = period.linhas.length === 1 ? ' linha' : ' linhas';
      return (
        '<div class="period-header">' +
          '<span class="period-name">' + esc(period.periodo) + '</span>' +
          '<span class="period-count">' + period.linhas.length + plural + '</span>' +
        '</div>' +
        '<div class="period-lines">' + period.linhas.map(renderLinhaCard).join('') + '</div>'
      );
    }).join('');
  }

  function renderLinhaCard(l) {
    return (
      '<a class="linha-card" href="#/rota/' + esc(l.id) + '">' +
        '<div class="bus-icon ' + busColorClass(l.cor) + '" aria-hidden="true">' + busIconSVG(23) + '</div>' +
        '<div class="linha-info">' +
          '<div class="linha-title">' + esc(l.titulo) + '</div>' +
          '<div class="linha-route">' + esc(l.origem) + ' → ' + esc(l.destino) + '</div>' +
          '<div class="linha-meta">' +
            '<span>Saída ' + l.partida + '</span><span class="dot-sep"></span>' +
            '<span>' + l.paradas.length + (l.paradas.length === 1 ? ' parada' : ' paradas') + '</span><span class="dot-sep"></span>' +
            '<span>' + l.duracao + ' min</span>' +
          '</div>' +
        '</div>' +
        '<div class="linha-side">' +
          '<span class="linha-dep">' + l.partida + '</span>' +
          chevronIcon('linha-chevron') +
        '</div>' +
      '</a>'
    );
  }

  /* =============================================================
     Geocodificação das paradas
     (dicionário local + fallback Nominatim)
     ============================================================= */
  var STOP_COORDS = {
    'campus 296 urca': [-43.17324390042479, -22.95231845530081],
    'campus 436 urca': [-43.16928, -22.95400],
    'campus 458 urca': [-43.1680, -22.9492],
    'central do brasil': [-43.19397, -22.90643],
    'sao cristovao': [-43.2220, -22.9050],
    'hugg': [-43.2378, -22.9240],
    'instituto biomedico': [-43.1809, -22.9052],
    'ccjp': [-43.1815, -22.9534],
    'general caldwell': [-43.192260515960825, -22.907789736839252],
    'eeap': [-43.1700, -22.9460],
    'shopping rio sul': [-43.1772, -22.9462],
    'pca xv': [-43.17367, -22.90519],
    'praca xv': [-43.1736, -22.9051],
    'terminal gentileza': [-43.21150, -22.89873],
    'aterro do flamengo': [-43.1820, -22.9370],
    'presidente wilson': [-43.1740, -22.9070],
    'presidente vargas': [-43.1920, -22.9040],
    'cidade nova': [-43.2110, -22.9070],
    'mariz e barros padaria': [-43.2380, -22.9240],
    'mariz e barros ponto senai': [-43.2340, -22.9210],
    'mariz e barros com sao francisco xavier': [-43.2400, -22.9260],
    'igreja de sao francisco xavier': [-43.2450, -22.9300],
    'praia de botafogo': [-43.1876, -22.9526],
    'avenida brasil antigo porcao': [-43.2130, -22.8900],
    'avenida brasil guadalupe': [-43.3550, -22.8490],
    'ricardo de albuquerque': [-43.3850, -22.8510],
    'anchieta': [-43.4000, -22.8400],
    'olinda': [-43.4150, -22.8320],
    'nilopolis': [-43.4136, -22.8070],
    'edson passos': [-43.4170, -22.7850],
    'mesquita': [-43.4290, -22.7840],
    'nova iguacu': [-43.4514, -22.7592],
    'meier': [-43.2810, -22.8980],
    'engenho de dentro': [-43.2990, -22.9020],
    'piedade': [-43.3080, -22.9070],
    'cascadura': [-43.3240, -22.9160],
    'madureira': [-43.3410, -22.9210],
    'bento ribeiro': [-43.3580, -22.9250],
    'deodoro': [-43.3780, -22.8560],
    'magalhaes bastos': [-43.3960, -22.8700],
    'realengo': [-43.4220, -22.8790],
    'padre miguel': [-43.4450, -22.8680],
    'bangu': [-43.4660, -22.8740],
    'senador camara': [-43.5020, -22.8770],
    'campo grande': [-43.5590, -22.9055]
  };

  var coordsCache = {};

  function matchCoordKey(normalized) {
    var best = null;
    Object.keys(STOP_COORDS).forEach(function (k) {
      if (normalized.indexOf(k) !== -1 && (!best || k.length > best.length)) best = k;
    });
    return best;
  }

  function resolveStop(name) {
    var key = normalize(name);
    if (key in coordsCache) return Promise.resolve(coordsCache[key]);
    var mk = matchCoordKey(key);
    if (mk) {
      coordsCache[key] = STOP_COORDS[mk];
      return Promise.resolve(STOP_COORDS[mk]);
    }
    return geocodeStop(name).then(function (c) {
      coordsCache[key] = c;
      return c;
    });
  }

  function geocodeStop(name) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' +
      encodeURIComponent(name + ', Rio de Janeiro');
    return fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data[0]) return [parseFloat(data[0].lon), parseFloat(data[0].lat)];
        return null;
      })
      .catch(function () { return null; });
  }

  /* Resolve as coordenadas de todos os pontos do trajeto, em sequência */
  function resolveLineCoords(line) {
    var coords = [];
    return line.pontos.reduce(function (chain, point) {
      return chain.then(function () {
        return resolveStop(point.nome);
      }).then(function (c) {
        coords.push(c);
      });
    }, Promise.resolve()).then(function () {
      return coords;
    });
  }

  /* =============================================================
     Rota no mapa
     ============================================================= */
  function renderStops(line, coords) {
    var pontos = line.pontos;
    $('rota-stops').innerHTML = pontos.map(function (stop, i) {
      var isLast = i === pontos.length - 1;
      var dotType = i === 0 ? ' origin' : isLast ? ' dest' : '';
      var missing = !coords[i] ? ' stop-missing' : '';
      var lineFrag = i < pontos.length - 1
        ? '<span class="stop-line"></span>'
        : '';
      return (
        '<div class="modal-stop' + (isLast ? ' last' : '') + missing + '">' +
          '<div class="stop-rail">' +
            '<span class="stop-dot' + dotType + '"></span>' +
            lineFrag +
          '</div>' +
          '<div class="stop-name">' + esc(stop.nome) + '</div>' +
          '<div class="stop-time">' + esc(stop.hora) + '</div>' +
        '</div>'
      );
    }).join('');
  }

  /* Geometria da via, do OSRM. Devolve também onde cada parada foi
      encaixada na rua (waypoints[].location), que é o ponto que a linha
      realmente percorre — e não a coordenada do portão do campus.
      O resultado é cacheado: a mesma sequência de paradas não paga o
      traçado duas vezes (redraws do mapa da home). */
  var roadCache = {};

  function roadGeometry(coords) {
    var str = coords.map(function (c) { return c[0] + ',' + c[1]; }).join(';');
    if (roadCache[str]) return Promise.resolve(roadCache[str]);
    var url = 'https://router.project-osrm.org/route/v1/driving/' + str +
      '?overview=full&geometries=geojson&steps=false';
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.code === 'Ok' && j.routes && j.routes[0]) {
          var result = {
            coords: j.routes[0].geometry.coordinates,
            stops: (j.waypoints || []).map(function (w) { return w.location; })
          };
          roadCache[str] = result;
          return result;
        }
        return null;
      })
      .catch(function () { return null; });
  }


  function addRouteToMap(geometry, line, coords) {
    try {
      if (rotaMap.getSource('rota-line')) {
        rotaMap.removeLayer('rota-line');
        rotaMap.removeSource('rota-line');
      }
      rotaMap.addSource('rota-line', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: geometry }
        }
      });
      rotaMap.addLayer({
        id: 'rota-line',
        type: 'line',
        source: 'rota-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f8ff4', 'line-width': 4, 'line-opacity': 0.85 }
      });

      line.pontos.forEach(function (point, i) {
        if (!coords[i]) return;
        var el = document.createElement('div');
        el.className = 'map-marker route-point' +
          (i === 0 ? ' origin' : i === line.pontos.length - 1 ? ' dest' : '');
        el.innerHTML = busIconSVG(12);
        el.title = point.nome;
        var popup = new maplibregl.Popup({ offset: 18, closeButton: false })
          .setHTML('<strong>' + esc(point.nome) + '</strong>' + esc(point.hora));
        new maplibregl.Marker({ element: el })
          .setLngLat(coords[i])
          .setPopup(popup)
          .addTo(rotaMap);
      });

      var marked = coords.filter(Boolean);
      if (marked.length < 2) return;
      var bounds = new maplibregl.LngLatBounds(marked[0], marked[0]);
      marked.forEach(function (c) { bounds.extend(c); });
      rotaMap.fitBounds(bounds, { padding: { top: 70, bottom: 70, left: 44, right: 44 }, maxZoom: 13 });
    } catch (e) {
      console.warn('Falha ao desenhar rota:', e);
    }
  }

  function showRouteView(lineId) {
    var line = null;
    lines.forEach(function (l) { if (l.id === lineId) line = l; });
    if (!line) {
      location.hash = '#/linhas';
      return;
    }

    setView('rota');
    navActive('linhas');
    rotaLineId = lineId;

    $('rota-title').textContent = line.titulo;
    $('rota-route').textContent = line.origem + ' → ' + line.destino;
    var rotaIcon = $('rota-icon');
    rotaIcon.className = 'bus-icon ' + busColorClass(line.cor);
    rotaIcon.innerHTML = busIconSVG(24);

    var plural = line.paradas.length === 1 ? ' parada' : ' paradas';
    $('rota-info').innerHTML =
      '<span class="rota-chip">' + clockIcon() + 'Saída ' + line.partida + '</span>' +
      '<span class="rota-chip">' + pinIcon() + 'Chegada ' + line.chegada + '</span>' +
      '<span class="rota-chip">Duração ' + line.duracao + ' min</span>' +
      '<span class="rota-chip">' + line.paradas.length + plural + '</span>' +
      '<span class="rota-chip">' + esc(line.campus) + '</span>';

    $('rota-stops').innerHTML = '<div class="rota-empty">Localizando paradas…</div>';

    cleanupRotaMap();

    rotaMap = new maplibregl.Map({
      container: 'rota-map',
      style: styleUrl(),
      center: [-43.25, -22.90],
      zoom: 9.5,
      minZoom: 5,
      maxZoom: 18,
      attributionControl: { compact: true }
    });
    rotaMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    resolveLineCoords(line).then(function (coords) {
      renderStops(line, coords);
      var valid = coords.filter(Boolean);
      if (valid.length < 2) {
        showToast('Não foi possível geolocalizar o trajeto.');
        startBusTracking(line, coords);
        return;
      }
      roadGeometry(valid).then(function (route) {
        var geom = (route && route.coords) || valid;
        /* O acompanhamento só começa com a via em mãos, para o ônibus
           nascer no mesmo desenho da linha, sem correção visível depois. */
        startBusTracking(line, coords, route);
        var apply = function () {
          if (!rotaMap || rotaMap._removed) return;
          addRouteToMap(geom, line, coords);
        };
        if (rotaMap.isStyleLoaded()) apply();
        else rotaMap.once('load', apply);
      });
    });
  }

  function cleanupRotaMap() {
    stopBusTracking();
    if (rotaMap) {
      try { rotaMap._removed = true; rotaMap.remove(); } catch (e) { /* noop */ }
      rotaMap = null;
    }
  }

  /* =============================================================
     Deslocamento de dia das paradas
     ============================================================= */
  /* Deslocamento de dia de cada ponto em relação à partida. Um horário que
     volta para trás (00:xx depois de 23:xx) significa que a viagem cruzou
     a meia-noite e os pontos seguintes pertencem ao dia seguinte. */
  function pointDayOffsets(pontos) {
    var day = 0;
    var prevMin = null;
    return (pontos || []).map(function (p) {
      var min = toMin(p.hora);
      if (prevMin !== null && min + 720 < prevMin) day += 1;
      prevMin = min;
      return day;
    });
  }

  /* =============================================================
     Localização estimada do ônibus
     ============================================================= */

  /* Converte a escala de horários da viagem para o domínio do relógio.
     Suporta viagens que atravessam meia-noite: quando o horário de uma
     parada volta para trás (00:xx depois de 23:xx), o dia é incrementado.
     O bloco inteiro é deslocado para a ocorrência mais próxima de nowMs,
     de modo que uma viagem que partiu "ontem" às 22:20 continue
     reconhecida às 00:30 de hoje. */
  function tripTimeline(trip, nowMs) {
    var dayStart = clockDayStartMs();
    var out = [];
    var day = 0;
    var prevMin = null;

    trip.pontos.forEach(function (point) {
      var min = toMin(point.hora);
      if (prevMin !== null && min + 720 < prevMin) day += 1;
      out.push({ nome: point.nome, hora: point.hora, day: day, min: min });
      prevMin = min;
    });

    if (!out.length) return out;
    var assumed = localTimeMs(dayStart, out[0].day, out[0].min);
    var shiftDays = Math.round((nowMs - assumed) / DAY_MS);
    out.forEach(function (p) {
      p.ms = localTimeMs(dayStart, p.day + shiftDays, p.min);
    });
    return out;
  }

  /* Janela de operação da viagem: partiu? está em curso? já terminou? */
  function tripWindow(trip, nowMs) {
    var tl = tripTimeline(trip, nowMs);
    if (!tl.length) return null;
    var startMs = tl[0].ms;
    var endMs = tl[tl.length - 1].ms;
    return {
      timeline: tl,
      startMs: startMs,
      endMs: endMs,
      started: nowMs >= startMs,
      active: nowMs >= startMs && nowMs <= endMs,
      finished: nowMs > endMs
    };
  }

  function isTripActive(trip, nowMs) {
    var w = tripWindow(trip, nowMs);
    return !!w && w.active;
  }

  /* Interpola linearmente entre dois pontos. Ordem MapLibre: [lng, lat]. */
  function interpolateCoordinates(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t
    ];
  }

  /* ---------- Caminho da rua ----------
     A reta entre duas paradas atravessa mar, morro e quarteirão. O
     desenho que o OSRM devolve (a mesma geometria da linha desenhada no
     mapa) é que precisa ser percorrido, então a posição do ônibus é
     calculada sobre essa polyline, e não entre as coordenadas das paradas.

     M_PER_DEG aparece igual nos dois eixos e se cancela no quociente;
     o que de fato importa é o fator cos(latitude) da longitude. */
  var M_PER_DEG = 111320;

  /* Prepara a polyline da rua: comprimento acumulado em metros e, para cada
     parada, o índice do vértice onde ela cai. */
  function buildStreetPath(coords, stops) {
    if (!coords || coords.length < 2) return null;

    var lats = coords.map(function (c) { return c[1]; });
    var lat0 = (Math.min.apply(null, lats) + Math.max.apply(null, lats)) / 2;
    var kx = M_PER_DEG * Math.cos(lat0 * Math.PI / 180);
    var ky = M_PER_DEG;

    var acc = [0];
    for (var i = 1; i < coords.length; i++) {
      var dx = (coords[i][0] - coords[i - 1][0]) * kx;
      var dy = (coords[i][1] - coords[i - 1][1]) * ky;
      acc.push(acc[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }

    /* Cada parada é projetada no vértice mais próximo *à frente*. A busca
       só avança de propósito: em linha de ida e volta a parada final é a
       ocorrência do fim do trajeto, não a do começo. */
    var stopIndex = [];
    var cursor = 0;
    (stops || []).forEach(function (stop) {
      var best = cursor;
      var bestD = Infinity;
      if (stop) {
        for (var v = cursor; v < coords.length; v++) {
          var ddx = (coords[v][0] - stop[0]) * kx;
          var ddy = (coords[v][1] - stop[1]) * ky;
          var d2 = ddx * ddx + ddy * ddy;
          if (d2 < bestD) { bestD = d2; best = v; }
        }
      }
      stopIndex.push(best);
      cursor = best;
    });

    return { coords: coords, acc: acc, stopIndex: stopIndex };
  }

  /* Ponto sobre a polyline, t da distância entre os vértices a e b.
     O tempo continua vindo do horário das paradas; aqui só respeitamos o
     desenho da via. Devolve null quando o trecho não tem comprimento. */
  function positionOnPath(path, a, b, t) {
    var last = path.coords.length - 1;
    var from = Math.max(0, Math.min(last, a));
    var to = Math.max(from, Math.min(last, b));
    var span = path.acc[to] - path.acc[from];
    if (span <= 0) return null;

    var target = path.acc[from] + span * t;
    var i = from;
    while (i < to && path.acc[i + 1] < target) i++;
    var seg = path.acc[i + 1] - path.acc[i];
    var local = seg > 0 ? (target - path.acc[i]) / seg : 0;
    return interpolateCoordinates(path.coords[i], path.coords[i + 1], Math.max(0, Math.min(1, local)));
  }

  /* Posição estimada: null se a viagem não estiver em curso. */
  function getBusPosition(trip, nowMs) {
    var pos = busPositionAt(trip, nowMs);
    return pos ? pos.coords : null;
  }

  function busPositionAt(trip, nowMs) {
    var w = tripWindow(trip, nowMs);
    if (!w || !w.active) return null;

    var tl = w.timeline;
    var coords = trip.coords || [];
    var path = trip.path;

    /* Só os pontos com coordenada conhecida entram no trajeto. */
    var legs = [];
    for (var i = 0; i < tl.length; i++) {
      if (coords[i]) {
        legs.push({ nome: tl[i].nome, hora: tl[i].hora, ms: tl[i].ms, coords: coords[i] });
      }
    }
    if (!legs.length) return null;

    var seg = 0;
    for (var j = legs.length - 1; j >= 0; j--) {
      if (legs[j].ms <= nowMs) { seg = j; break; }
    }

    /* Índice onde cada perna entra e sai na polyline da via. */
    var a = path && path.stopIndex[seg];
    var b = path && path.stopIndex[Math.min(seg + 1, path.stopIndex.length - 1)];
    var onRoad = typeof a === 'number' && typeof b === 'number' && b > a;

    var from = legs[seg];
    var to = legs[Math.min(seg + 1, legs.length - 1)];
    if (from === to) {
      /* Última parada: encosta no ponto em que a via passa por ela, e não
         na coordenada bruta do geocodificador (que pode estar dezenas de
         metros fora da rua). */
      return {
        coords: typeof a === 'number' ? path.coords[a] : from.coords,
        from: from,
        to: to,
        progress: 1,
        onRoad: typeof a === 'number'
      };
    }

    var span = to.ms - from.ms;
    var t = span > 0 ? (nowMs - from.ms) / span : 1;
    t = Math.max(0, Math.min(1, t));

    /* Caminho da rua quando existe; senão reta entre as duas paradas. */
    var pos = onRoad ? positionOnPath(path, a, b, t) : null;
    if (!pos) pos = interpolateCoordinates(from.coords, to.coords, t);

    return {
      coords: pos,
      from: from,
      to: to,
      progress: t,
      onRoad: onRoad
    };
  }

  function createBusMarker(trip) {
    var el = document.createElement('div');
    el.className = 'map-marker bus-marker ' + busColorClass(trip.cor);
    el.innerHTML = busIconSVG(18);
    el.title = 'Ônibus — localização estimada';
    return new maplibregl.Marker({ element: el });
  }

  function removeBusMarker() {
    if (busMarker) {
      try { busMarker.remove(); } catch (e) { /* noop */ }
      busMarker = null;
    }
  }

  /* Inicia o acompanhamento da viagem. Garante um único loop e um único
     marcador: qualquer chamada anterior é cancelada antes de começar.
     `route` é o retorno do OSRM (geometria da via + onde cada parada foi
     encaixada nela). Sem ele, cai no trajeto em linha reta entre paradas. */
  function startBusTracking(trip, coords, route) {
    stopBusTracking();
    if (!trip || !rotaMap) return;
    trip.coords = coords;

    var known = [];
    (trip.pontos || []).forEach(function (p, i) {
      if (coords && coords[i]) known.push(coords[i]);
    });
    trip.path = buildStreetPath(
      route && route.coords ? route.coords : known,
      route && route.stops ? route.stops : known
    );

    busTrip = trip;
    busTick();
  }

  function stopBusTracking() {
    if (busRafId) {
      cancelAnimationFrame(busRafId);
      busRafId = 0;
    }
    removeBusMarker();
    busTrip = null;
    busLogAt = 0;
  }

  function busTick() {
    busRafId = 0;
    if (!busTrip || !rotaMap || rotaMap._removed) return;

    var nowMs = getClockMs();
    var w = tripWindow(busTrip, nowMs);

    if (!w || w.finished) {
      removeBusMarker();
      return;
    }

    var pos = busPositionAt(busTrip, nowMs);
    if (pos) {
      if (!busMarker) {
        busMarker = createBusMarker(busTrip).setLngLat(pos.coords).addTo(rotaMap);
      } else {
        busMarker.setLngLat(pos.coords);
      }
      logBusPosition(nowMs, pos);
    } else {
      removeBusMarker();
    }

    busRafId = requestAnimationFrame(busTick);
  }

  /* Log de depuração: no máximo uma vez por segundo, para não inundar
     o console a 60 quadros por segundo. */
  function logBusPosition(nowMs, pos) {
    var realNow = Date.now();
    if (realNow - busLogAt < 1000) return;
    busLogAt = realNow;
    console.log(
      '[Intercampi] Hora simulada: ' + getSimulatedTime() +
      '\n[Intercampi] Viagem: ' + busTrip.nome + ' (' + busTrip.id + ')' +
      '\n[Intercampi] Entre: ' + pos.from.nome + ' (' + pos.from.hora + ') -> ' +
        pos.to.nome + ' (' + pos.to.hora + ')' +
      '\n[Intercampi] Progresso: ' + Math.round(pos.progress * 100) + '%' +
      '\n[Intercampi] Via: ' + (pos.onRoad ? 'seguindo a rua' : 'reta entre paradas') +
      '\n[Intercampi] Coordenadas: [' + pos.coords[0].toFixed(5) + ', ' + pos.coords[1].toFixed(5) + ']'
    );
  }

  /* =============================================================
     Mapa da Home
     ============================================================= */
  function initHomeMap() {
    homeMap = new maplibregl.Map({
      container: 'home-map',
      style: styleUrl(),
      center: [-43.22, -22.89],
      zoom: 9.4,
      minZoom: 5,
      maxZoom: 18
    });
    homeMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    /* Sem pontos fixos: o mapa mostra as rotas padrão das próximas linhas,
       desenhadas assim que os dados e a via estiverem prontos. */
    homeMap.on('load', function () {
      renderHomeTrips();
    });
  }

  function setUserMarker(lngLat) {
    if (userMarker) {
      userMarker.setLngLat(lngLat);
      return;
    }
    var el = document.createElement('div');
    el.className = 'map-marker user';
    el.title = 'Sua localização';
    userMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(homeMap);
  }

  function setDestMarker(coords, label) {
    if (destMarker) {
      destMarker.remove();
      destMarker = null;
    }
    var el = document.createElement('div');
    el.className = 'map-marker dest';
    el.title = label || 'Destino';
    var popup = new maplibregl.Popup({ offset: 20, closeButton: false })
      .setHTML('<strong>' + esc(label || 'Destino') + '</strong>');
    destMarker = new maplibregl.Marker({ element: el })
      .setLngLat(coords)
      .setPopup(popup)
      .addTo(homeMap);
  }

  function locateMe() {
    if (!navigator.geolocation) {
      showToast('Geolocalização não suportada neste navegador.');
      return;
    }
    showToast('Buscando sua localização…');
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var lngLat = [pos.coords.longitude, pos.coords.latitude];
        setUserMarker(lngLat);
        homeMap.flyTo({ center: lngLat, zoom: 14, essential: true });
        originInput.value = 'Minha localização';
        showToast('Localização definida.');
      },
      function () {
        showToast('Não foi possível obter sua localização.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  /* =============================================================
     Destino — seleção limitada aos pontos de parada do JSON
     ============================================================= */
  function renderSuggest(query) {
    if (!stopNames.length) return;
    var q = normalize(query);
    var matches = stopNames.filter(function (n) {
      return !q || normalize(n).indexOf(q) !== -1;
    });

    destSuggest.innerHTML = matches.length
      ? matches.map(function (n) {
          return (
            '<button type="button" class="suggest-item' + (n === destStopName ? ' selected' : '') +
              '" role="option" data-stop="' + esc(n) + '">' +
              pinIcon() + '<span>' + esc(n) + '</span>' +
            '</button>'
          );
        }).join('')
      : '<div class="suggest-empty">Nenhum ponto de parada encontrado.</div>';

    destSuggest.hidden = false;
    destInput.setAttribute('aria-expanded', 'true');
  }

  function hideSuggest() {
    destSuggest.hidden = true;
    destInput.setAttribute('aria-expanded', 'false');
  }

  function pickFirstSuggestion() {
    if (!stopNames.length) {
      showToast('Carregando os horários…');
      return;
    }
    var first = destSuggest.querySelector('[data-stop]');
    if (!first) {
      showToast('Escolha um ponto de parada da lista.');
      return;
    }
    selectDestination(first.getAttribute('data-stop'));
  }

  function selectDestination(name) {
    destInput.value = name;
    hideSuggest();

    if (name === destStopName) return;
    destStopName = name;
    nextTripSig = null;
    showToast('Destino: ' + name);

    resolveStop(name).then(function (c) {
      if (c && destStopName === name) setDestMarker(c, name);
    });
    refreshNextTrip();
  }

  function clearDestination() {
    if (!destStopName && !nextTripCard.hasChildNodes()) return;
    destStopName = null;
    nextTripSig = null;
    if (destMarker) {
      destMarker.remove();
      destMarker = null;
    }
    clearHomeRoute();
    nextTripCard.hidden = true;
    nextTripCard.innerHTML = '';
    renderHomeTrips();   /* sem destino: voltam as rotas padrão das linhas */
    renderDefaultRoute();   /* e a rota do próximo ônibus volta ao destaque */
  }

  /* Confere o valor digitado com a lista oficial de paradas. usada no blur
     e na troca origem/destino: texto que não seja ponto de parada não
     gera rota. */
  function syncDestination() {
    var match = findStopByName(destInput.value);
    if (!match) {
      clearDestination();
      return;
    }
    if (match !== destStopName) selectDestination(match);
  }

  /* Próxima ocorrência futura de uma viagem que passa pelo ponto. Considera
     a partida de ontem (viagens que cruzam a meia-noite), de hoje e de
     amanhã, e escolhe a primeira em que o ônibus ainda vai chegar ao ponto. */
  function nextTripThroughStop(stopName) {
    if (!lines.length) return null;
    var nowMs = getClockMs();
    var dayStart = clockDayStartMs();
    var target = normalize(stopName);
    var best = null;

    lines.forEach(function (l) {
      var idx = -1;
      l.pontos.forEach(function (p, i) {
        if (idx < 0 && normalize(p.nome) === target) idx = i;
      });
      if (idx < 0) return;

      var days = pointDayOffsets(l.pontos);
      var depMin = toMin(l.partida);
      var stopMin = toMin(l.pontos[idx].hora);

      [-1, 0, 1].forEach(function (d) {
        var depMs = localTimeMs(dayStart, d, depMin);
        var stopMs = localTimeMs(dayStart, d + days[idx], stopMin);
        if (stopMs < nowMs) return;
        if (!best || stopMs < best.stopMs || (stopMs === best.stopMs && depMs < best.depMs)) {
          best = { line: l, stop: l.pontos[idx], depMs: depMs, stopMs: stopMs };
        }
      });
    });

    return best;
  }

  function fmtDur(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }

  function renderNextTripCard(info) {
    var l = info.line;
    var nowMs = getClockMs();
    var untilDep = Math.round((info.depMs - nowMs) / 60000);
    var untilStop = Math.max(1, Math.round((info.stopMs - nowMs) / 60000));
    var timing = untilDep > 0
      ? 'Saída em ' + (untilDep < 60 ? untilDep + ' min' : fmtDur(untilDep))
      : 'Passa por aqui em ' + untilStop + ' min';

    nextTripCard.hidden = false;
    nextTripCard.innerHTML =
      '<a class="next-trip-inner" href="#/rota/' + esc(l.id) + '">' +
        '<div class="bus-icon ' + busColorClass(l.cor) + '" aria-hidden="true">' + busIconSVG(22) + '</div>' +
        '<div class="next-trip-info">' +
          '<div class="next-trip-title">Próximo: ' + esc(l.titulo) + '</div>' +
          '<div class="next-trip-route">' + esc(l.origem) + ' → ' + esc(l.destino) + '</div>' +
          '<div class="next-trip-meta">' +
            '<span>' + clockIcon() + 'Saída ' + l.partida + '</span>' +
            '<span>' + pinIcon() + esc(stripParens(info.stop.nome)) + ' às ' + info.stop.hora + '</span>' +
          '</div>' +
        '</div>' +
        '<span class="next-trip-badge">' + esc(timing) + '</span>' +
      '</a>';
  }

  function refreshNextTrip() {
    if (!destStopName || !lines.length) return;
    var info = nextTripThroughStop(destStopName);
    if (!info) {
      nextTripSig = null;
      nextTripCard.hidden = false;
      nextTripCard.innerHTML =
        '<div class="next-trip-empty">Nenhuma viagem futura passa por este ponto.</div>';
      clearHomeRoute();
      return;
    }

    var sig = info.line.id + '|' + info.depMs + '|' + info.stopMs;
    var changed = sig !== nextTripSig;
    nextTripSig = sig;
    renderNextTripCard(info);
    if (changed) {
      clearHomeTrips();   /* sem destino: as rotas padrão saem de cena */
      drawHomeRoute(info.line);
    }
  }

  /* =============================================================
     Rota do próximo intercampi no mapa da Home
     ============================================================= */
  var ROUTE_HEX = { blue: '#1f8ff4', orange: '#f59e0b', maroon: '#b3262e' };
  var autoRouteSig = null;

  /* Estado padrão da Home: sem destino, a rota do próximo ônibus que vai
     sair fica destacada por cima das rotas padrão. O marcador da camada
     cobre o caso de a rota ter sido apagada (destino limpo, troca de
     tema) com a mesma assinatura de viagem. */
  function renderDefaultRoute() {
    if (destStopName || loadError || !lines.length || !homeMap) return;
    var picks = nextTrips(1);
    if (!picks.length) return;
    var sig = picks[0].line.id;
    var hasLayer = false;
    try { hasLayer = !!homeMap.getLayer('home-route'); } catch (e) { hasLayer = false; }
    if (sig === autoRouteSig && hasLayer) return;
    autoRouteSig = sig;
    drawHomeRoute(picks[0].line);
  }

  /* Espera o estilo do mapa ficar pronto para receber camadas. O evento
     'load' acontece uma única vez por estilo e isStyleLoaded() oscila
     durante animações de câmera (fitBounds), então o poll cobre o caso
     de a resposta chegar quando os dois já passaram. */
  function onMapReady(map, fn) {
    if (!map || map._removed) return;
    var done = false;
    var run = function () { if (done) return; done = true; fn(); };
    try { if (map.isStyleLoaded()) { run(); return; } } catch (e) { /* noop */ }
    map.once('load', run);
    var tries = 0;
    var poll = setInterval(function () {
      if (done || !map || map._removed || ++tries > 100) { clearInterval(poll); return; }
      try {
        if (map.isStyleLoaded()) { clearInterval(poll); run(); }
      } catch (e) { clearInterval(poll); }
    }, 100);
  }

  function clearHomeRoute() {
    homeRouteToken++;
    homeRouteMarkers.forEach(function (m) {
      try { m.remove(); } catch (e) { /* noop */ }
    });
    homeRouteMarkers = [];
    if (!homeMap) return;
    try {
      if (homeMap.getLayer('home-route')) homeMap.removeLayer('home-route');
      if (homeMap.getSource('home-route')) homeMap.removeSource('home-route');
    } catch (e) { /* noop */ }
  }

  function drawHomeRoute(line) {
    clearHomeRoute();
    if (!homeMap || loadError) return;
    var token = homeRouteToken;

    resolveLineCoords(line).then(function (coords) {
      var valid = coords.filter(Boolean);
      if (valid.length < 2) {
        showToast('Não foi possível geolocalizar o trajeto.');
        return;
      }
      roadGeometry(valid).then(function (route) {
        var geom = (route && route.coords) || valid;
        var apply = function () {
          if (token !== homeRouteToken) return;      /* destino mudou no meio do caminho */
          if (!homeMap || homeMap._removed) return;
          try {
            homeMap.addSource('home-route', {
              type: 'geojson',
              data: {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: geom }
              }
            });
            homeMap.addLayer({
              id: 'home-route',
              type: 'line',
              source: 'home-route',
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': ROUTE_HEX[line.cor] || ROUTE_HEX.blue,
                'line-width': 4,
                'line-opacity': 0.85
              }
            });

            line.pontos.forEach(function (point, i) {
              if (!coords[i]) return;
              /* o ponto escolhido já tem o marcador de destino */
              if (normalize(point.nome) === normalize(destStopName)) return;
              var el = document.createElement('div');
              el.className = 'map-marker route-point' + (i === 0 ? ' origin' : '');
              el.innerHTML = busIconSVG(12);
              el.title = point.nome;
              var popup = new maplibregl.Popup({ offset: 16, closeButton: false })
                .setHTML('<strong>' + esc(point.nome) + '</strong>' + esc(point.hora));
              homeRouteMarkers.push(
                new maplibregl.Marker({ element: el }).setLngLat(coords[i]).setPopup(popup).addTo(homeMap)
              );
            });

            if (valid.length >= 2) {
              var bounds = new maplibregl.LngLatBounds(valid[0], valid[0]);
              valid.forEach(function (c) { bounds.extend(c); });
              homeMap.fitBounds(bounds, {
                padding: { top: 44, bottom: 44, left: 40, right: 40 },
                maxZoom: 12.5,
                duration: 900
              });
            }
          } catch (e) {
            console.warn('Falha ao desenhar rota na home:', e);
          }
        };
        onMapReady(homeMap, apply);
      });
    });
  }

  /* =============================================================
     Rotas padrão das linhas no mapa da Home
     Os marcadores fixos foram removidos: o mapa mostra o traçado e as
     paradas das próximas viagens (as mesmas de "Próximas viagens"),
     uma cor por linha. Quando um destino é escolhido, essas rotas saem
     de cena e sobra a do intercampi selecionado.
     ============================================================= */
  function removeMapLayerAndSource(map, id) {
    if (!map) return;
    try {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    } catch (e) { /* noop */ }
  }

  function removeMarkers(list) {
    list.forEach(function (m) {
      try { m.remove(); } catch (e) { /* noop */ }
    });
    list.length = 0;
  }

  function clearHomeTrips() {
    homeTripsToken++;
    homeTripsSig = null;
    removeMarkers(homeTripMarkers);
    homeTripSourceIds.forEach(function (id) { removeMapLayerAndSource(homeMap, id); });
    homeTripSourceIds = [];
  }

  /* Desenha as próximas viagens no mapa, se a composição mudou. */
  function renderHomeTrips() {
    if (destStopName || loadError || !lines.length) return;
    var picks = nextTrips(2);
    var sig = picks.map(function (t) { return t.line.id; }).join(',');
    if (sig === homeTripsSig) return;
    drawHomeTrips(picks.map(function (t) { return t.line; }));
    homeTripsSig = sig;
  }

  function drawHomeTrips(tripLines) {
    clearHomeTrips();
    if (!homeMap) return;
    var token = homeTripsToken;

    var jobs = tripLines.map(function (line) {
      return resolveLineCoords(line).then(function (coords) {
        var valid = coords.filter(Boolean);
        if (valid.length < 2) return null;
        return roadGeometry(valid).then(function (route) {
          return { line: line, coords: coords, geom: (route && route.coords) || valid };
        });
      });
    });

    Promise.all(jobs).then(function (results) {
      var apply = function () {
        if (token !== homeTripsToken || !homeMap || homeMap._removed) return;
        results.forEach(function (r) { if (r) paintHomeTrip(r); });
        fitHomeTrips(results.filter(Boolean));
      };
      onMapReady(homeMap, apply);
    });
  }

  function paintHomeTrip(r) {
    var id = 'home-trip-' + String(r.line.id).replace(/[^a-z0-9]/gi, '');
    try {
      homeMap.addSource(id, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: r.geom }
        }
      });
      homeMap.addLayer({
        id: id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_HEX[r.line.cor] || ROUTE_HEX.blue,
          'line-width': 2.5,
          'line-opacity': 0.55
        }
      });
      homeTripSourceIds.push(id);

      r.line.pontos.forEach(function (point, i) {
        if (!r.coords[i]) return;
        var el = document.createElement('div');
        el.className = 'map-marker route-point' + (i === 0 ? ' origin' : '');
        el.innerHTML = busIconSVG(12);
        el.title = point.nome;
        var popup = new maplibregl.Popup({ offset: 14, closeButton: false })
          .setHTML('<strong>' + esc(point.nome) + '</strong>' + esc(point.hora));
        homeTripMarkers.push(
          new maplibregl.Marker({ element: el }).setLngLat(r.coords[i]).setPopup(popup).addTo(homeMap)
        );
      });
    } catch (e) {
      console.warn('Falha ao desenhar linha na home:', e);
    }
  }

  /* Enquadra o mapa uma única vez, para abraçar todas as rotas mostradas
     sem roubar o pan/zoom do usuário nos próximos redraws. */
  var homeTripsFitted = false;

  function fitHomeTrips(list) {
    if (homeTripsFitted || !list.length) return;
    var bounds = null;
    list.forEach(function (r) {
      r.coords.forEach(function (c) {
        if (!c) return;
        if (!bounds) bounds = new maplibregl.LngLatBounds(c, c);
        else bounds.extend(c);
      });
    });
    if (!bounds) return;
    homeTripsFitted = true;
    homeMap.fitBounds(bounds, {
      padding: { top: 40, bottom: 40, left: 36, right: 36 },
      maxZoom: 11.5,
      duration: 900
    });
  }

  /* =============================================================
     Modo escuro
     ============================================================= */
  function isThemeDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function styleUrl() {
    return isThemeDark() ? STYLE_URL_DARK : STYLE_URL;
  }

  /* O basemap acompanha o tema. Os overlays (rotas e marcadores)
     somem junto com o estilo antigo e são redesenhados quando o
     novo estilo estiver pronto. A câmera é preservada pelo setStyle. */
  function restyleHomeMap() {
    if (!homeMap || homeMap._removed) return;
    clearHomeRoute();
    clearHomeTrips();
    homeTripsSig = null;
    try { homeMap.setStyle(styleUrl()); } catch (e) { return; }

    var tries = 0;
    var poll = setInterval(function () {
      if (!homeMap || homeMap._removed) { clearInterval(poll); return; }
      var ready = false;
      try { ready = homeMap.isStyleLoaded(); } catch (e) { ready = false; }
      if (!ready) {
        if (++tries > 100) clearInterval(poll);   /* estilos remotos podem falhar */
        return;
      }
      clearInterval(poll);
      refreshNextTrip();
      renderHomeTrips();
      renderDefaultRoute();
    }, 100);
  }

  /* A página de rota cria o mapa a cada abertura: reconstruir é o
     caminho mais simples para trocar o estilo sem perder o itinerário. */
  function restyleRotaMap() {
    if (currentView === 'rota' && rotaLineId) showRouteView(rotaLineId);
  }

  function syncThemeBtn(dark) {
    var btn = $('theme-btn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    btn.title = dark ? 'Modo claro' : 'Modo escuro';
    btn.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
  }

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* noop */ }
    syncThemeBtn(dark);

    restyleHomeMap();
    restyleRotaMap();
  }

  /* =============================================================
     Navegação / views / modal / toast
     ============================================================= */
  function setView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].hidden = k !== name;
    });
    currentView = name;
    if (name === 'home') {
      startEmCursoWatch();
      renderEmCurso();
      startHomeWatch();
      refreshNextTrip();
      renderHomeTrips();
      renderDefaultRoute();
      if (homeMap) {
        setTimeout(function () {
          try { homeMap.resize(); } catch (e) { /* noop */ }
        }, 60);
      }
    } else {
      stopEmCursoWatch();
      stopHomeWatch();
    }
    window.scrollTo(0, 0);
  }

  function navActive(name) {
    navItems.forEach(function (el) {
      el.classList.toggle('active', el.dataset.nav === name);
    });
  }

  function openModal(line) {
    var plural = line.pontos.length === 1 ? ' parada' : ' paradas';
    modalContent.innerHTML =
      '<div class="modal-body">' +
        '<div class="modal-head">' +
          '<div class="bus-icon ' + busColorClass(line.cor) + '">' + busIconSVG(23) + '</div>' +
          '<div>' +
            '<div class="modal-title" id="modal-title">' + esc(line.titulo) + '</div>' +
            '<div class="modal-route">' + esc(line.origem) + ' → ' + esc(line.destino) + '</div>' +
            '<div class="modal-times">' +
              '<span class="modal-badge">Saída ' + line.partida + '</span>' +
              '<span class="modal-badge">Chegada ' + line.chegada + '</span>' +
              '<span class="modal-badge">' + line.duracao + ' min</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-stops-title">Itinerário · ' + line.pontos.length + plural + '</div>' +
        line.pontos.map(function (stop, i) {
          var isLast = i === line.pontos.length - 1;
          var dotType = i === 0 ? ' origin' : isLast ? ' dest' : '';
          var lineFrag = i < line.pontos.length - 1 ? '<span class="stop-line"></span>' : '';
          return (
            '<div class="modal-stop' + (isLast ? ' last' : '') + '">' +
              '<div class="stop-rail">' +
                '<span class="stop-dot' + dotType + '"></span>' + lineFrag +
              '</div>' +
              '<div class="stop-name">' + esc(stop.nome) + '</div>' +
              '<div class="stop-time">' + esc(stop.hora) + '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>' +
      '<button type="button" class="modal-action" id="modal-action">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-8-4.5-8-11a8 8 0 0 1 16 0c0 6.5-8 11-8 11z"/><circle cx="12" cy="10" r="3"/></svg>' +
        'Ver rota no mapa' +
      '</button>';

    var actionBtn = $('modal-action');
    actionBtn.addEventListener('click', function () {
      closeModal();
      location.hash = '#/rota/' + line.id;
    });

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2200);
  }

  /* =============================================================
     Router
     ============================================================= */
  function router() {
    var hash = location.hash || '#/home';
    var prev = currentView;

    if (!/^#\/(home|linhas|rota\/)/.test(hash)) hash = '#/home';

    if (prev === 'rota' && hash.indexOf('#/rota/') !== 0) {
      cleanupRotaMap();
    }

    var m = /^#\/rota\/(.+)$/.exec(hash);
    if (m) {
      showRouteView(decodeURIComponent(m[1]));
    } else if (hash === '#/linhas') {
      setView('linhas');
      navActive('linhas');
      renderLinhas();
    } else {
      setView('home');
      navActive('home');
    }
  }

  /* =============================================================
     Eventos
     ============================================================= */
  function bindEvents() {
    swapBtn.addEventListener('click', function () {
      var tmp = originInput.value;
      originInput.value = destInput.value;
      destInput.value = tmp;
      syncDestination();
    });

    locateBtn.addEventListener('click', locateMe);

    var themeBtn = $('theme-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () { applyTheme(!isThemeDark()); });
      /* estado inicial (o <head> já aplicou o atributo; o botão precisa acompanhar) */
      syncThemeBtn(isThemeDark());
    }

    destInput.addEventListener('focus', function () {
      renderSuggest(destInput.value);
    });

    /* clique reabre a lista mesmo quando o campo já tinha o foco */
    destInput.addEventListener('click', function () {
      renderSuggest(destInput.value);
    });

    destInput.addEventListener('input', function () {
      renderSuggest(destInput.value);
      if (!destInput.value.trim()) clearDestination();
    });

    destInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (destSuggest.hidden) renderSuggest(destInput.value);
        pickFirstSuggestion();
      } else if (e.key === 'Escape') {
        hideSuggest();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        renderSuggest(destInput.value);
        var first = destSuggest.querySelector('[data-stop]');
        if (first) first.focus();
      }
    });

    destSuggest.addEventListener('mousedown', function (e) {
      var item = e.target.closest ? e.target.closest('[data-stop]') : null;
      if (!item) return;
      e.preventDefault();
      selectDestination(item.getAttribute('data-stop'));
    });

    destSuggest.addEventListener('keydown', function (e) {
      var items = [].slice.call(destSuggest.querySelectorAll('[data-stop]'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items[i + 1]) items[i + 1].focus();
        else destInput.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (i > 0) items[i - 1].focus();
        else destInput.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (i >= 0) selectDestination(items[i].getAttribute('data-stop'));
      } else if (e.key === 'Escape') {
        hideSuggest();
        destInput.focus();
      }
    });

    destInput.addEventListener('blur', function () {
      setTimeout(function () {
        hideSuggest();
        syncDestination();
      }, 120);
    });

    originInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        locateMe();
      }
    });

    document.querySelectorAll('[data-close-modal]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    window.addEventListener('hashchange', router);
    window.addEventListener('resize', function () {
      if (homeMap) homeMap.resize();
    });
  }

  /* =============================================================
     Boot
     ============================================================= */
  function boot() {
    bindEvents();
    initHomeMap();
    renderHome();
    router();

    fetch('horarios_intercampi.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        buildFromData(data);
        renderHome();
        renderLinhas();
        renderHomeTrips();
        renderDefaultRoute();
        refreshNextTrip();
        if (location.hash.indexOf('#/rota/') === 0) router();
      })
      .catch(function () {
        loadError = true;
        $('header-status').textContent = 'Sem dados';
        renderHome();
        renderLinhas();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();