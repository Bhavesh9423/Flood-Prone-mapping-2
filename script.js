// ══════════════════════════════════════════════════════════════════════════
// FLOOD RISK INTELLIGENCE & GIS PLATFORM — script.js
// Clean Map-First GIS Engine, Floating Telemetry, 3D Elevation & Analytics
// ══════════════════════════════════════════════════════════════════════════

// Global State
let map;
let allFeatures = [];
let floodLayer;
let heatmapLayerGroup;
let isHeatmapActive = false;
let cityCentroids = {};
let activeFilters = { High: true, Medium: true, Low: true };
let maxElevFilter = 1000;
let minRainFilter = 0;
let selectedDistrict = null;
const weatherCache = {};

// Risk Spectrum Palette
const RISK_COLORS = {
    High:   { fill: '#ef4444', border: '#dc2626', glow: 'rgba(239, 68, 68, 0.45)' },
    Medium: { fill: '#f59e0b', border: '#d97706', glow: 'rgba(245, 158, 11, 0.45)' },
    Low:    { fill: '#10b981', border: '#059669', glow: 'rgba(16, 185, 129, 0.45)' }
};

// Basemaps (100% Free, Unwatermarked, No API Key Required)
const BASEMAPS = {
    dark: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ | Flood Risk Intelligence',
        maxNativeZoom: 16,
        maxZoom: 19
    },
    street: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS | Flood Risk Intelligence',
        maxNativeZoom: 19,
        maxZoom: 19
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye | Flood Risk Intelligence',
        maxNativeZoom: 19,
        maxZoom: 19
    },
    terrain: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> | &copy; OpenTopoMap',
        maxNativeZoom: 17,
        maxZoom: 19
    }
};
let currentTileLayer;

// 3D Three.js State
let terrainScene, terrainCamera, terrainRenderer, terrainControls;
let waterMesh, terrainMesh, rainParticles;
let isSurgeAnimating = false;

// Chart.js Instances
let chartRiskDistInst, chartElevRainInst, chartPopImpactInst;

// ══════════════════════════════════════════════════════════════════════════
// 1. INITIALIZATION & DATA LOADING
// ══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    init2DMap();
    loadGeoJSONData();
    setupViewSwitcher();
    setupPillFilters();
    setupSlidersPopover();
    setupSearch();
    setupModals();
    setupDistrictCardActions();
});

// ══════════════════════════════════════════════════════════════════════════
// 2. 2D LEAFLET MAP ENGINE
// ══════════════════════════════════════════════════════════════════════════

function init2DMap() {
    map = L.map('map', { zoomControl: false, center: [22.5, 79.5], zoom: 5 });

    // Position zoom controls cleanly at top-right below tool buttons
    L.control.zoom({ position: 'topright' }).addTo(map);

    const darkCfg = BASEMAPS.dark;
    currentTileLayer = L.tileLayer(darkCfg.url, {
        attribution: darkCfg.attribution,
        maxNativeZoom: darkCfg.maxNativeZoom,
        maxZoom: darkCfg.maxZoom
    }).addTo(map);

    floodLayer = L.layerGroup().addTo(map);
    heatmapLayerGroup = L.layerGroup().addTo(map);

    // Basemap selector dropdown
    const basemapSelect = document.getElementById('basemapSelect');
    basemapSelect?.addEventListener('change', (e) => {
        const style = e.target.value;
        const cfg = BASEMAPS[style];
        if (cfg) {
            map.removeLayer(currentTileLayer);
            currentTileLayer = L.tileLayer(cfg.url, {
                attribution: cfg.attribution,
                maxNativeZoom: cfg.maxNativeZoom || 18,
                maxZoom: cfg.maxZoom || 19
            }).addTo(map);
        }
    });

    // Recenter map button
    document.getElementById('recenterMapBtn')?.addEventListener('click', () => {
        map.setView([22.5, 79.5], 5, { animate: true });
    });

    // Heatmap density glow toggle
    document.getElementById('toggleHeatmapBtn')?.addEventListener('click', () => {
        isHeatmapActive = !isHeatmapActive;
        const btn = document.getElementById('toggleHeatmapBtn');
        if (btn) btn.style.background = isHeatmapActive ? 'rgba(239, 68, 68, 0.35)' : '';
        renderMap();
    });

    // Legend collapse toggle
    document.getElementById('toggleLegendBtn')?.addEventListener('click', () => {
        const body = document.getElementById('legendBody');
        const btn = document.getElementById('toggleLegendBtn');
        if (body && btn) {
            const isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'flex' : 'none';
            btn.textContent = isHidden ? '−' : '+';
        }
    });
}

function getStyle(risk) {
    const c = RISK_COLORS[risk] || RISK_COLORS.Low;
    return {
        fillColor: c.fill,
        color: c.border,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.45,
        dashArray: risk === 'Low' ? '4' : '0'
    };
}

function calculateCentroid(coords) {
    let latSum = 0, lonSum = 0, n = 0;
    const ring = coords[0];
    ring.forEach(pt => { lonSum += pt[0]; latSum += pt[1]; n++; });
    return [latSum / n, lonSum / n];
}

async function loadGeoJSONData() {
    updateLoadingProgress(30, 'Fetching GeoJSON Risk Layer...');
    try {
        let data = null;
        if (typeof window !== 'undefined' && window.FLOOD_RISK_GEOJSON) {
            data = window.FLOOD_RISK_GEOJSON;
        } else {
            const res = await fetch('flood_risk_data.geojson');
            data = await res.json();
        }
        allFeatures = data.features;

        allFeatures.forEach(f => {
            cityCentroids[f.properties.district_name] = calculateCentroid(f.geometry.coordinates);
        });

        updateLoadingProgress(70, 'Initializing Spatial Layers...');
        renderMap();
        updateStatCounts();
        populateCompareSelectors();

        updateLoadingProgress(100, 'System Ready');
        setTimeout(hideLoadingScreen, 400);
    } catch (err) {
        console.warn('Network fetch failed or CORS blocked on file://, checking embedded fallback...', err);
        if (typeof window !== 'undefined' && window.FLOOD_RISK_GEOJSON) {
            allFeatures = window.FLOOD_RISK_GEOJSON.features;
            allFeatures.forEach(f => {
                cityCentroids[f.properties.district_name] = calculateCentroid(f.geometry.coordinates);
            });
            renderMap();
            updateStatCounts();
            populateCompareSelectors();
            updateLoadingProgress(100, 'System Ready');
            setTimeout(hideLoadingScreen, 400);
        } else {
            console.error('Failed to load GeoJSON:', err);
            updateLoadingProgress(100, 'Error Loading Data');
            hideLoadingScreen();
        }
    }
}

function renderMap() {
    floodLayer.clearLayers();
    heatmapLayerGroup.clearLayers();

    const filtered = allFeatures.filter(f => {
        const p = f.properties;
        const passRisk = activeFilters[p.risk_level];
        const passElev = p.elevation <= maxElevFilter;
        const passRain = p.rainfall >= minRainFilter;
        return passRisk && passElev && passRain;
    });

    L.geoJSON({ type: 'FeatureCollection', features: filtered }, {
        style: f => getStyle(f.properties.risk_level),
        onEachFeature: (feature, layer) => {
            const p = feature.properties;

            layer.on('mouseover', function () {
                this.setStyle({ fillOpacity: 0.75, weight: 3 });
                this.bindTooltip(
                    `<div style="font-family:'Outfit',sans-serif; padding:4px 6px;">
                        <strong style="font-size:14px; color:#fff;">${p.district_name}</strong>, ${p.state}<br>
                        <span style="color:${RISK_COLORS[p.risk_level].fill}; font-weight:700;">${p.risk_level} Risk Zone</span>
                    </div>`,
                    { sticky: true }
                ).openTooltip();
            });

            layer.on('mouseout', function () {
                this.setStyle(getStyle(p.risk_level));
                this.closeTooltip();
            });

            layer.on('click', function () {
                openDistrictCard(p);
            });
        }
    }).addTo(floodLayer);

    if (isHeatmapActive) {
        filtered.forEach(f => {
            const coords = cityCentroids[f.properties.district_name];
            if (coords) {
                const color = RISK_COLORS[f.properties.risk_level].fill;
                L.circleMarker(coords, {
                    radius: f.properties.risk_level === 'High' ? 35 : 22,
                    fillColor: color,
                    color: color,
                    weight: 0,
                    fillOpacity: 0.35
                }).addTo(heatmapLayerGroup);
            }
        });
    }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. FLOATING DISTRICT DETAIL CARD & LIVE WEATHER
// ══════════════════════════════════════════════════════════════════════════

async function openDistrictCard(p) {
    selectedDistrict = p;
    const card = document.getElementById('districtCard');
    if (!card) return;

    const coords = cityCentroids[p.district_name];

    // Populate Data
    document.getElementById('dcName').textContent = p.district_name;
    document.getElementById('dcState').textContent = `${p.state} • ${coords ? `${coords[0].toFixed(2)}° N, ${coords[1].toFixed(2)}° E` : ''}`;
    
    const badge = document.getElementById('dcRiskBadge');
    if (badge) {
        badge.className = `risk-pill ${p.risk_level.toLowerCase()}`;
        badge.textContent = `${p.risk_level.toUpperCase()} RISK`;
    }

    document.getElementById('dcElevation').textContent = `${p.elevation} m`;
    document.getElementById('dcRainfall').textContent = `${p.rainfall} mm`;
    document.getElementById('dcRiverDist').textContent = `${p.river_dist} km`;
    document.getElementById('dcPopulation').textContent = p.population;

    document.getElementById('dcRiver').textContent = p.river || 'Local Catchment / River Basin';
    document.getElementById('dcZones').textContent = p.flood_zones || 'Low-lying river banks & flood plains';

    // Weather reset
    const wStatus = document.getElementById('dcWeatherStatus');
    const wTemp = document.getElementById('dcWeatherTemp');
    const wHumidity = document.getElementById('dcWeatherHumidity');
    const wRain = document.getElementById('dcWeatherRain');
    const wWind = document.getElementById('dcWeatherWind');

    if (wStatus) wStatus.textContent = 'Fetching Live...';
    if (wTemp) wTemp.textContent = '--°C';
    if (wHumidity) wHumidity.textContent = '--%';
    if (wRain) wRain.textContent = '-- mm/h';
    if (wWind) wWind.textContent = '-- km/h';

    // Open card
    card.classList.add('open');

    // Fetch live weather
    const w = await fetchLiveWeather(p.district_name, coords);
    if (wStatus) wStatus.textContent = w.live ? '✅ Open-Meteo' : '⚡ Est.';
    if (wTemp) wTemp.textContent = `${w.temp}°C`;
    if (wHumidity) wHumidity.textContent = `${w.humidity}%`;
    if (wRain) wRain.textContent = `${w.rain} mm/h`;
    if (wWind) wWind.textContent = `${w.wind} km/h`;
}

function setupDistrictCardActions() {
    document.getElementById('closeDistrictCardBtn')?.addEventListener('click', () => {
        document.getElementById('districtCard')?.classList.remove('open');
    });

    document.getElementById('dcView3DBtn')?.addEventListener('click', () => {
        document.querySelector('.nav-tab[data-view="3d-terrain"]')?.click();
    });

    document.getElementById('dcCompareBtn')?.addEventListener('click', () => {
        if (selectedDistrict) {
            const selA = document.getElementById('compareSelectA');
            if (selA) selA.value = selectedDistrict.district_name;
        }
        document.getElementById('compareModal')?.classList.add('open');
        renderComparison();
    });
}

// Live Weather Fetcher (Open-Meteo API)
async function fetchLiveWeather(districtName, coords) {
    const key = `${districtName}_${new Date().getHours()}`;
    if (weatherCache[key]) return weatherCache[key];
    if (!coords) return getSimulatedWeather(districtName);

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords[0].toFixed(3)}&longitude=${coords[1].toFixed(3)}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&timezone=Asia%2FKolkata`;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(tid);

        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        const c = data.current;

        const result = {
            temp: Math.round(c.temperature_2m),
            humidity: Math.round(c.relative_humidity_2m),
            rain: Number(c.precipitation).toFixed(1),
            wind: Math.round(c.wind_speed_10m),
            live: true
        };
        weatherCache[key] = result;
        return result;
    } catch (e) {
        return getSimulatedWeather(districtName);
    }
}

function getSimulatedWeather(districtName) {
    return {
        temp: 29,
        humidity: 76,
        rain: (Math.random() * 8).toFixed(1),
        wind: Math.round(12 + Math.random() * 8),
        live: false
    };
}

// ══════════════════════════════════════════════════════════════════════════
// 4. FLOATING FILTER PILLS & SLIDERS
// ══════════════════════════════════════════════════════════════════════════

function setupPillFilters() {
    const pills = [
        { id: 'pillAll', filter: 'all' },
        { id: 'pillHigh', filter: 'High' },
        { id: 'pillMedium', filter: 'Medium' },
        { id: 'pillLow', filter: 'Low' }
    ];

    pills.forEach(p => {
        document.getElementById(p.id)?.addEventListener('click', () => {
            // Update active states
            pills.forEach(other => document.getElementById(other.id)?.classList.remove('active'));
            document.getElementById(p.id)?.classList.add('active');

            if (p.filter === 'all') {
                activeFilters = { High: true, Medium: true, Low: true };
            } else {
                activeFilters = { High: false, Medium: false, Low: false };
                activeFilters[p.filter] = true;
            }

            renderMap();
            updateStatCounts();
        });
    });
}

function setupSlidersPopover() {
    const popover = document.getElementById('filterPopover');
    const toggleBtn = document.getElementById('toggleFilterPopoverBtn');
    const closeBtn = document.getElementById('closeFilterPopoverBtn');
    const resetBtn = document.getElementById('resetSlidersBtn');

    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        popover?.classList.toggle('open');
    });

    closeBtn?.addEventListener('click', () => {
        popover?.classList.remove('open');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (popover && !popover.contains(e.target) && e.target !== toggleBtn) {
            popover.classList.remove('open');
        }
    });

    const elevSlider = document.getElementById('elevationSlider');
    elevSlider?.addEventListener('input', (e) => {
        maxElevFilter = parseFloat(e.target.value);
        document.getElementById('elevSliderVal').textContent = maxElevFilter + ' m';
        renderMap();
        updateStatCounts();
    });

    const rainSlider = document.getElementById('rainfallSlider');
    rainSlider?.addEventListener('input', (e) => {
        minRainFilter = parseFloat(e.target.value);
        document.getElementById('rainSliderVal').textContent = minRainFilter + ' mm';
        renderMap();
        updateStatCounts();
    });

    resetBtn?.addEventListener('click', () => {
        maxElevFilter = 1000;
        minRainFilter = 0;
        if (elevSlider) elevSlider.value = 1000;
        if (rainSlider) rainSlider.value = 0;
        document.getElementById('elevSliderVal').textContent = '1000 m';
        document.getElementById('rainSliderVal').textContent = '0 mm';
        renderMap();
        updateStatCounts();
    });
}

function updateStatCounts() {
    const totalEl = document.getElementById('totalDistCount');
    const hEl = document.getElementById('highRiskCount');
    const mEl = document.getElementById('mediumRiskCount');
    const lEl = document.getElementById('lowRiskCount');

    if (totalEl) totalEl.textContent = allFeatures.length;
    if (hEl) hEl.textContent = allFeatures.filter(f => f.properties.risk_level === 'High').length;
    if (mEl) mEl.textContent = allFeatures.filter(f => f.properties.risk_level === 'Medium').length;
    if (lEl) lEl.textContent = allFeatures.filter(f => f.properties.risk_level === 'Low').length;
}

// ══════════════════════════════════════════════════════════════════════════
// 5. DISTRICT SEARCH
// ══════════════════════════════════════════════════════════════════════════

function setupSearch() {
    const input = document.getElementById('searchInput');
    const clearBtn = document.getElementById('searchClearBtn');

    function executeSearch() {
        const query = input.value.trim().toLowerCase();
        if (!query) return;

        const hit = allFeatures.find(f =>
            f.properties.district_name.toLowerCase().includes(query) ||
            f.properties.state.toLowerCase().includes(query)
        );

        if (hit) {
            const coords = cityCentroids[hit.properties.district_name];
            if (coords) {
                // Ensure 2D map tab is active
                document.querySelector('.nav-tab[data-view="2d-map"]')?.click();
                map.setView(coords, 9, { animate: true });
                openDistrictCard(hit.properties);
            }
        }
    }

    input?.addEventListener('input', () => {
        if (clearBtn) clearBtn.classList.toggle('visible', input.value.length > 0);
    });

    input?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executeSearch();
    });

    clearBtn?.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.remove('visible');
    });
}

// ══════════════════════════════════════════════════════════════════════════
// 6. VIEW SWITCHER (2D Map, 3D Terrain, Analytics)
// ══════════════════════════════════════════════════════════════════════════

function setupViewSwitcher() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const viewId = tab.getAttribute('data-view');
            document.querySelectorAll('.view-panel').forEach(vp => vp.classList.remove('active'));

            if (viewId === '2d-map') {
                document.getElementById('view2DMap')?.classList.add('active');
                setTimeout(() => map.invalidateSize(), 150);
            }
            if (viewId === '3d-terrain') {
                document.getElementById('view3DTerrain')?.classList.add('active');
                init3DTerrain();
            }
            if (viewId === 'analytics') {
                document.getElementById('viewAnalytics')?.classList.add('active');
                initAnalyticsCharts();
            }
        });
    });
}

// ══════════════════════════════════════════════════════════════════════════
// 7. 3D THREE.JS INUNDATION & TERRAIN SIMULATOR
// ══════════════════════════════════════════════════════════════════════════

function init3DTerrain() {
    const container = document.getElementById('threeTerrainCanvasContainer');
    if (!container || terrainRenderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    terrainScene = new THREE.Scene();
    terrainScene.background = new THREE.Color(0x020617);
    terrainScene.fog = new THREE.FogExp2(0x020617, 0.005);

    terrainCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    terrainCamera.position.set(0, 70, 120);

    terrainRenderer = new THREE.WebGLRenderer({ antialias: true });
    terrainRenderer.setSize(width, height);
    terrainRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(terrainRenderer.domElement);

    terrainControls = new THREE.OrbitControls(terrainCamera, terrainRenderer.domElement);
    terrainControls.enableDamping = true;
    terrainControls.dampingFactor = 0.05;
    terrainControls.maxPolarAngle = Math.PI / 2 - 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    terrainScene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x06b6d4, 1.2);
    dirLight.position.set(50, 100, 50);
    terrainScene.add(dirLight);

    // Procedural Heightmap Mesh
    const terrainGeo = new THREE.PlaneGeometry(160, 160, 80, 80);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const elevation = Math.sin(x * 0.04) * Math.cos(z * 0.04) * 16 +
                          Math.sin(x * 0.1) * 4 +
                          Math.cos(z * 0.08) * 4;
        pos.setY(i, Math.max(0, elevation));
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainScene.add(terrainMesh);

    // Rising Water Plane
    const waterGeo = new THREE.PlaneGeometry(160, 160);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.65, roughness: 0.1 });
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = 12;
    terrainScene.add(waterMesh);

    createRainSystem();

    document.getElementById('simWaterSlider')?.addEventListener('input', (e) => {
        const depth = parseFloat(e.target.value);
        waterMesh.position.y = depth;
        document.getElementById('simWaterVal').textContent = depth.toFixed(1) + ' m';
    });

    document.getElementById('simAnimateBtn')?.addEventListener('click', toggleSurgeAnimation);
    document.getElementById('simResetBtn')?.addEventListener('click', () => {
        terrainCamera.position.set(0, 70, 120);
        terrainControls.target.set(0, 0, 0);
    });

    window.addEventListener('resize', () => {
        if (!container || !terrainRenderer || !terrainCamera) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        terrainCamera.aspect = w / h;
        terrainCamera.updateProjectionMatrix();
        terrainRenderer.setSize(w, h);
    });

    animate3DTerrain();
}

function createRainSystem() {
    const rainGeo = new THREE.BufferGeometry();
    const rainCount = 1000;
    const pos = new Float32Array(rainCount * 3);

    for (let i = 0; i < rainCount * 3; i += 3) {
        pos[i] = (Math.random() - 0.5) * 160;
        pos[i + 1] = Math.random() * 80;
        pos[i + 2] = (Math.random() - 0.5) * 160;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const rainMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.6, transparent: true, opacity: 0.7 });
    rainParticles = new THREE.Points(rainGeo, rainMat);
    terrainScene.add(rainParticles);
}

function animate3DTerrain() {
    requestAnimationFrame(animate3DTerrain);

    if (rainParticles) {
        const positions = rainParticles.geometry.attributes.position.array;
        for (let i = 1; i < positions.length; i += 3) {
            positions[i] -= 1.2;
            if (positions[i] < 0) positions[i] = 80;
        }
        rainParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (isSurgeAnimating && waterMesh) {
        const time = Date.now() * 0.002;
        waterMesh.position.y = 10 + Math.sin(time) * 12;
        const slider = document.getElementById('simWaterSlider');
        const val = document.getElementById('simWaterVal');
        if (slider) slider.value = waterMesh.position.y;
        if (val) val.textContent = waterMesh.position.y.toFixed(1) + ' m';
    }

    terrainControls.update();
    terrainRenderer.render(terrainScene, terrainCamera);
}

function toggleSurgeAnimation() {
    isSurgeAnimating = !isSurgeAnimating;
    const btn = document.getElementById('simAnimateBtn');
    if (btn) btn.textContent = isSurgeAnimating ? '⏸ Pause' : '▶ Surge Pulse';
}

// ══════════════════════════════════════════════════════════════════════════
// 8. ANALYTICS (Chart.js)
// ══════════════════════════════════════════════════════════════════════════

function initAnalyticsCharts() {
    if (chartRiskDistInst) return; // Already initialized

    const ctx1 = document.getElementById('chartRiskDistribution')?.getContext('2d');
    if (ctx1) {
        const h = allFeatures.filter(f => f.properties.risk_level === 'High').length;
        const m = allFeatures.filter(f => f.properties.risk_level === 'Medium').length;
        const l = allFeatures.filter(f => f.properties.risk_level === 'Low').length;

        chartRiskDistInst = new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: ['High Risk', 'Medium Risk', 'Low Risk'],
                datasets: [{
                    data: [h, m, l],
                    backgroundColor: ['#ef4444', '#f59e0b', '#10b981'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Inter' } } }
                }
            }
        });
    }

    const ctx2 = document.getElementById('chartElevRain')?.getContext('2d');
    if (ctx2) {
        const pts = allFeatures.map(f => ({
            x: f.properties.elevation,
            y: f.properties.rainfall
        }));

        chartElevRainInst = new Chart(ctx2, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Districts',
                    data: pts,
                    backgroundColor: '#06b6d4',
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#94a3b8' }, title: { display: true, text: 'Elevation (m)', color: '#cbd5e1' } },
                    y: { ticks: { color: '#94a3b8' }, title: { display: true, text: 'Rainfall (mm)', color: '#cbd5e1' } }
                },
                plugins: {
                    legend: { labels: { color: '#94a3b8' } }
                }
            }
        });
    }

    const ctx3 = document.getElementById('chartPopulationImpact')?.getContext('2d');
    if (ctx3) {
        const highDistricts = allFeatures.filter(f => f.properties.risk_level === 'High').slice(0, 8);
        const labels = highDistricts.map(f => f.properties.district_name);
        const pops = highDistricts.map(f => parseFloat(f.properties.population));

        chartPopImpactInst = new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Population at Risk (Millions)',
                    data: pops,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: '#cbd5e1' } },
                    y: { ticks: { color: '#cbd5e1' }, title: { display: true, text: 'Millions', color: '#cbd5e1' } }
                },
                plugins: {
                    legend: { labels: { color: '#94a3b8' } }
                }
            }
        });
    }
}

// ══════════════════════════════════════════════════════════════════════════
// 9. MODALS & COMPARISON ENGINE
// ══════════════════════════════════════════════════════════════════════════

function setupModals() {
    // SOS Modal
    document.getElementById('openSosBtn')?.addEventListener('click', () => {
        document.getElementById('sosModal')?.classList.add('open');
    });
    document.getElementById('closeSosModalBtn')?.addEventListener('click', () => {
        document.getElementById('sosModal')?.classList.remove('open');
    });

    // Methodology Modal
    document.getElementById('openMethodologyBtn')?.addEventListener('click', () => {
        document.getElementById('methodologyModal')?.classList.add('open');
    });
    document.getElementById('closeMethodologyModalBtn')?.addEventListener('click', () => {
        document.getElementById('methodologyModal')?.classList.remove('open');
    });

    // Compare Modal
    document.getElementById('compareModeBtn')?.addEventListener('click', () => {
        document.getElementById('compareModal')?.classList.add('open');
        renderComparison();
    });
    document.getElementById('closeCompareModalBtn')?.addEventListener('click', () => {
        document.getElementById('compareModal')?.classList.remove('open');
    });

    document.getElementById('compareSelectA')?.addEventListener('change', renderComparison);
    document.getElementById('compareSelectB')?.addEventListener('change', renderComparison);

    // Backdrop click to close modals
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('open');
        });
    });
}

function populateCompareSelectors() {
    const selA = document.getElementById('compareSelectA');
    const selB = document.getElementById('compareSelectB');
    if (!selA || !selB) return;

    const options = allFeatures.map(f => `<option value="${f.properties.district_name}">${f.properties.district_name} (${f.properties.state})</option>`).join('');
    selA.innerHTML = options;
    selB.innerHTML = options;

    if (allFeatures.length > 1) selB.value = allFeatures[1].properties.district_name;
}

function renderComparison() {
    const nameA = document.getElementById('compareSelectA')?.value;
    const nameB = document.getElementById('compareSelectB')?.value;
    const grid = document.getElementById('compareGridResult');
    if (!grid || !nameA || !nameB) return;

    const featA = allFeatures.find(f => f.properties.district_name === nameA);
    const featB = allFeatures.find(f => f.properties.district_name === nameB);
    if (!featA || !featB) return;

    const pA = featA.properties;
    const pB = featB.properties;

    grid.innerHTML = `
        <div class="compare-col">
            <h4 style="font-size:1.1rem; color:var(--primary);">${pA.district_name}</h4>
            <div><strong>State:</strong> ${pA.state}</div>
            <div><strong>Risk Level:</strong> <span style="color:${RISK_COLORS[pA.risk_level].fill}; font-weight:700;">${pA.risk_level}</span></div>
            <div><strong>Avg Elevation:</strong> ${pA.elevation} m</div>
            <div><strong>Annual Rainfall:</strong> ${pA.rainfall} mm</div>
            <div><strong>Nearest River:</strong> ${pA.river || 'N/A'} (${pA.river_dist} km)</div>
            <div><strong>Population:</strong> ${pA.population}</div>
        </div>
        <div class="compare-col">
            <h4 style="font-size:1.1rem; color:var(--primary);">${pB.district_name}</h4>
            <div><strong>State:</strong> ${pB.state}</div>
            <div><strong>Risk Level:</strong> <span style="color:${RISK_COLORS[pB.risk_level].fill}; font-weight:700;">${pB.risk_level}</span></div>
            <div><strong>Avg Elevation:</strong> ${pB.elevation} m</div>
            <div><strong>Annual Rainfall:</strong> ${pB.rainfall} mm</div>
            <div><strong>Nearest River:</strong> ${pB.river || 'N/A'} (${pB.river_dist} km)</div>
            <div><strong>Population:</strong> ${pB.population}</div>
        </div>
    `;
}

// ══════════════════════════════════════════════════════════════════════════
// 10. LOADING PROGRESS HELPERS
// ══════════════════════════════════════════════════════════════════════════

function updateLoadingProgress(percent, text) {
    const bar = document.getElementById('loadingBar');
    const status = document.getElementById('loadingStatusText');
    if (bar) bar.style.width = percent + '%';
    if (status) status.textContent = text;
}

function hideLoadingScreen() {
    const screen = document.getElementById('loadingScreen');
    if (screen) screen.classList.add('hidden');
}
