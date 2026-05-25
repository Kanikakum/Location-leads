import { useState, useRef, useMemo, useEffect } from "react";
import axios from "axios";

const ITEMS_PER_PAGE = 10;

const PIN_SVG = (color = "#ff6b35") => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="40">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="9" r="2.5" fill="white"/>
  </svg>
`;

const SUGGESTED_KEYWORDS = [
  "software companies", "IT companies", "restaurants", "hotels",
  "hospitals", "law firms", "real estate agencies", "marketing agencies",
  "schools", "gyms", "dental clinics", "CA firms",
];

const POPULAR_LOCATIONS = [
  "Jaipur", "Delhi", "Mumbai", "Bangalore", "Hyderabad",
  "Pune", "Chennai", "Kolkata", "Ahmedabad", "Surat",
];

export default function App() {
  const [keyword, setKeyword]         = useState("");
  const [location, setLocation]       = useState("");
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState([]);
  const [error, setError]             = useState("");
  const [done, setDone]               = useState(false);
  const [selected, setSelected]       = useState(null);
  const [view, setView]               = useState("table");
  const [page, setPage]               = useState(1);
  const [filterRating, setFilterRating] = useState(0);
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasPhone, setFilterHasPhone] = useState(false);
  const [filterHasWebsite, setFilterHasWebsite] = useState(false);
  const [filterLocation, setFilterLocation] = useState("");
  const [sortBy, setSortBy]           = useState("default");
  const [showKeywordSuggestions, setShowKeywordSuggestions] = useState(false);
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [limit, setLimit]             = useState(20);
  const [detectingLocation, setDetectingLocation] = useState(false);

  const mapRef         = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef     = useRef([]);
  const keywordRef     = useRef(null);
  const locationRef    = useRef(null);

  const query = [keyword.trim(), location.trim()].filter(Boolean).join(" in ");

  // ── Filtered + sorted results ───────────────────────────────────────────────
  const filteredResults = useMemo(() => {
    let r = [...results];
    if (filterRating > 0)   r = r.filter(x => ratingNum(x) >= filterRating);
    if (filterHasEmail)     r = r.filter(x => x.email);
    if (filterHasPhone)     r = r.filter(x => x.phone);
    if (filterHasWebsite)   r = r.filter(x => x.website);
    if (filterLocation)     r = r.filter(x => (x.address || "").toLowerCase().includes(filterLocation.toLowerCase()));
    if (sortBy === "rating-desc") r.sort((a, b) => (ratingNum(b) || 0) - (ratingNum(a) || 0));
    if (sortBy === "rating-asc")  r.sort((a, b) => (ratingNum(a) || 0) - (ratingNum(b) || 0));
    if (sortBy === "name-asc")    r.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === "name-desc")   r.sort((a, b) => b.name.localeCompare(a.name));
    return r;
  }, [results, filterRating, filterHasEmail, filterHasPhone, filterHasWebsite, filterLocation, sortBy]);

  const totalPages   = Math.max(1, Math.ceil(filteredResults.length / ITEMS_PER_PAGE));
  const pagedResults = filteredResults.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterRating, filterHasEmail, filterHasPhone, filterHasWebsite, filterLocation, sortBy]);

  // ── Load Leaflet ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== "map" || leafletReady) return;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => { setLeafletReady(true); };
    document.head.appendChild(script);
  }, [view]);

  useEffect(() => {
    if (view === "map" && leafletReady && done) initMap();
  }, [view, leafletReady, filteredResults]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const detectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || data.address?.state || "";
          if (city) {
            setLocation(city);
          } else {
            setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
          }
        } catch (err) {
          console.error("Error reverse geocoding:", err);
          setLocation(`${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`);
        } finally {
          setDetectingLocation(false);
        }
      },
      (error) => {
        console.error("Geolocation error:", error);
        alert("Could not detect your location. Please type it manually.");
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSearch = async () => {
    if (!keyword.trim()) { setError("Please enter a keyword"); return; }
    if (!location.trim()) { setError("Please enter a location"); return; }
    setError(""); setResults([]); setDone(false); setSelected(null); setPage(1);
    try {
      setLoading(true);
      const res = await axios.post("http://localhost:5000/scrape", { query, limit });
      const data = res.data.results || [];
      setResults(data);
      setDone(true);
      if (data.length === 0) setError("No results found. Try a different query.");
    } catch (err) {
      setError(err.response?.data?.message || "Scraping failed. Check the server terminal.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCSV = async () => {
    if (!filteredResults.length) return;
    try {
      const res = await axios.post("http://localhost:5000/download-csv", { results: filteredResults }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url; a.setAttribute("download", `leads-${query.replace(/ /g, "-")}.csv`);
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { alert("CSV download failed"); }
  };

  const handleRowClick = (r) => {
    setSelected(r);
    if (view === "map" && r.lat && r.lng && mapInstanceRef.current) {
      mapInstanceRef.current.setView([parseFloat(r.lat), parseFloat(r.lng)], 16);
    }
  };

  const initMap = () => {
    if (!window.L || !mapRef.current) return;
    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    const valid = filteredResults.filter(r => r.lat && r.lng);
    const center = valid.length > 0 ? [parseFloat(valid[0].lat), parseFloat(valid[0].lng)] : [26.9124, 75.7873];
    const map = window.L.map(mapRef.current).setView(center, 13);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map);
    markersRef.current = [];
    valid.forEach((r) => {
      const icon = window.L.divIcon({
        className: "", html: PIN_SVG(selected?.name === r.name ? "#e11d48" : "#ff6b35"),
        iconSize: [32, 40], iconAnchor: [16, 40],
      });
      const marker = window.L.marker([parseFloat(r.lat), parseFloat(r.lng)], { icon }).addTo(map)
        .bindPopup(`<div style="font-family:sans-serif;min-width:190px;padding:4px">
          <strong style="font-size:13px">${r.name}</strong><br/>
          ${r.rating ? `<span style="color:#f59e0b;font-size:12px">★ ${ratingNum(r)}</span> ` : ""}
          ${r.category ? `<span style="color:#888;font-size:11px">${r.category}</span>` : ""}<br/>
          ${r.address ? `<span style="font-size:11px">📍 ${r.address}</span><br/>` : ""}
          ${r.phone ? `<span style="font-size:11px">📞 ${r.phone}</span><br/>` : ""}
          ${r.email ? `<span style="font-size:11px">✉ ${r.email}</span><br/>` : ""}
          ${r.website ? `<a href="${r.website.startsWith("http") ? r.website : "https://"+r.website}" target="_blank" style="font-size:11px;color:#ff6b35">🌐 Website</a>` : ""}
        </div>`);
      marker.on("click", () => setSelected(r));
      markersRef.current.push(marker);
    });
    mapInstanceRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
  };

  const clearFilters = () => {
    setFilterRating(0); setFilterHasEmail(false);
    setFilterHasPhone(false); setFilterHasWebsite(false);
    setFilterLocation(""); setSortBy("default");
  };

  const activeFiltersCount = [filterRating > 0, filterHasEmail, filterHasPhone, filterHasWebsite, filterLocation, sortBy !== "default"].filter(Boolean).length;

  return (
    <div style={S.page}>
      {/* ── TOP HEADER ── */}
      <div style={S.topHeader}>
        <div style={S.brand}>
          <div style={S.brandIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#ff6b35"/>
              <circle cx="12" cy="9" r="2.5" fill="white"/>
            </svg>
          </div>
          <span style={S.brandName}>LeadScraper</span>
        </div>
        {done && results.length > 0 && (
          <button style={S.csvHeaderBtn} onClick={handleDownloadCSV}>
            ↓ Export CSV ({filteredResults.length})
          </button>
        )}
      </div>

      {/* ── SEARCH PANEL ── */}
      <div style={S.searchPanel}>
        <h2 style={S.searchTitle}>Find Business Leads</h2>
        <p style={S.searchSub}>Search Google Maps by keyword + location to extract contacts</p>

        <div style={S.searchGrid} id="search-grid">
          {/* Keyword input */}
          <div style={S.fieldWrap} ref={keywordRef}>
            <label style={S.label}>Keyword</label>
            <div style={S.inputBox}>
              <svg style={S.inputIcon} width="14" height="14" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="#555" strokeWidth="2"/>
                <path d="M21 21l-4.35-4.35" stroke="#555" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input
                style={S.input}
                placeholder="e.g. software companies"
                value={keyword}
                onChange={e => { setKeyword(e.target.value); setShowKeywordSuggestions(true); }}
                onFocus={() => setShowKeywordSuggestions(true)}
                onBlur={() => setTimeout(() => setShowKeywordSuggestions(false), 150)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                disabled={loading}
              />
            </div>
            {showKeywordSuggestions && (
              <div style={S.suggestions}>
                {SUGGESTED_KEYWORDS.filter(k => k.toLowerCase().includes(keyword.toLowerCase()) && k.toLowerCase() !== keyword.toLowerCase())
                  .slice(0, 6).map(k => (
                    <div key={k} style={S.suggItem} onMouseDown={() => { setKeyword(k); setShowKeywordSuggestions(false); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="7" stroke="#555" strokeWidth="2"/>
                        <path d="M21 21l-4.35-4.35" stroke="#555" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      {k}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Location input */}
          <div style={S.fieldWrap} ref={locationRef}>
            <label style={S.label}>Location</label>
            <div style={S.inputBox}>
              <svg style={S.inputIcon} width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="#555" strokeWidth="2" fill="none"/>
                <circle cx="12" cy="9" r="2" stroke="#555" strokeWidth="2" fill="none"/>
              </svg>
              <input
                style={{ ...S.input, paddingRight: "40px" }}
                placeholder="e.g. Jaipur"
                value={location}
                onChange={e => { setLocation(e.target.value); setShowLocationSuggestions(true); }}
                onFocus={() => setShowLocationSuggestions(true)}
                onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 150)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                disabled={loading}
              />
              <button
                type="button"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: detectingLocation || loading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px",
                  color: detectingLocation ? "#ff6b35" : "#666",
                  transition: "color 0.2s",
                }}
                onClick={detectLocation}
                disabled={detectingLocation || loading}
                title="Detect current location"
              >
                {detectingLocation ? (
                  <span style={{ ...S.spinner, width: "14px", height: "14px", border: "2px solid rgba(255,107,53,0.3)", borderTop: "2px solid #ff6b35" }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <circle cx="12" cy="12" r="3" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                  </svg>
                )}
              </button>
            </div>
            {showLocationSuggestions && (
              <div style={S.suggestions}>
                {POPULAR_LOCATIONS.filter(l => l.toLowerCase().includes(location.toLowerCase()) && l.toLowerCase() !== location.toLowerCase())
                  .slice(0, 6).map(l => (
                    <div key={l} style={S.suggItem} onMouseDown={() => { setLocation(l); setShowLocationSuggestions(false); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#ff6b35">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                      </svg>
                      {l}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Limit input */}
          <div style={S.fieldWrap}>
            <label style={S.label}>Max Results</label>
            <div style={S.inputBox}>
              <svg style={S.inputIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <select
                style={S.selectInput}
                value={limit}
                onChange={e => setLimit(parseInt(e.target.value, 10))}
                disabled={loading}
              >
                <option value={5}>5 leads (Fast)</option>
                <option value={10}>10 leads</option>
                <option value={20}>20 leads</option>
                <option value={50}>50 leads</option>
                <option value={100}>100 leads (Deep Scrape)</option>
              </select>
              {/* Custom dropdown arrow */}
              <div style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
                color: "#555",
                display: "flex",
                alignItems: "center"
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
          </div>

          {/* Search button */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <button
              style={{ ...S.searchBtn, opacity: loading ? 0.7 : 1, cursor: loading ? "not-allowed" : "pointer" }}
              onClick={handleSearch} disabled={loading}
            >
              {loading ? <><span style={S.spinner} /> Scraping...</> : "🔍 Search"}
            </button>
          </div>
        </div>

        {/* Query preview */}
        {(keyword || location) && (
          <div style={S.queryPreview}>
            Searching: <span style={{ color: "#ff6b35", fontWeight: "600" }}>"{query}"</span> on Google Maps
          </div>
        )}

        {loading && (
          <div style={S.progressWrap}>
            <div style={S.progressBar}><div style={S.progressFill} /></div>
            <p style={S.progressText}>Opening Google Maps · Scrolling results · Extracting data... (1–3 min)</p>
          </div>
        )}
        {error && <div style={S.errorBox}>⚠ {error}</div>}
      </div>

      {/* ── RESULTS AREA ── */}
      {done && results.length > 0 && (
        <div style={S.resultsArea}>

          {/* ── FILTER BAR ── */}
          <div style={S.filterBar}>
            <div style={S.filterLeft}>
              <span style={S.filterTitle}>
                Filters
                {activeFiltersCount > 0 && <span style={S.filterBadge}>{activeFiltersCount}</span>}
              </span>

              {/* Rating filter */}
              <div style={S.filterGroup}>
                <span style={S.filterLabel}>Min Rating</span>
                <div style={S.ratingBtns}>
                  {[0, 3, 3.5, 4, 4.5].map(v => (
                    <button key={v} style={{ ...S.ratingBtn, ...(filterRating === v ? S.ratingBtnActive : {}) }}
                      onClick={() => setFilterRating(v)}>
                      {v === 0 ? "All" : `${v}+`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkbox filters */}
              <div style={S.checkFilters}>
                {[
                  { label: "Has Email", state: filterHasEmail, set: setFilterHasEmail },
                  { label: "Has Phone", state: filterHasPhone, set: setFilterHasPhone },
                  { label: "Has Website", state: filterHasWebsite, set: setFilterHasWebsite },
                ].map(({ label, state, set }) => (
                  <label key={label} style={S.checkLabel}>
                    <div style={{ ...S.checkbox, ...(state ? S.checkboxActive : {}) }}
                      onClick={() => set(!state)}>
                      {state && <span style={S.checkmark}>✓</span>}
                    </div>
                    {label}
                  </label>
                ))}
              </div>

              {/* Location filter */}
              <div style={S.filterGroup}>
                <input
                  style={S.filterInput}
                  placeholder="Filter by area..."
                  value={filterLocation}
                  onChange={e => setFilterLocation(e.target.value)}
                />
              </div>
            </div>

            <div style={S.filterRight}>
              {/* Sort */}
              <select style={S.sortSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="default">Sort: Default</option>
                <option value="rating-desc">Rating: High → Low</option>
                <option value="rating-asc">Rating: Low → High</option>
                <option value="name-asc">Name: A → Z</option>
                <option value="name-desc">Name: Z → A</option>
              </select>

              {activeFiltersCount > 0 && (
                <button style={S.clearBtn} onClick={clearFilters}>✕ Clear</button>
              )}

              {/* View toggle */}
              <div style={S.viewToggle}>
                <button style={{ ...S.toggleBtn, ...(view === "table" ? S.toggleActive : {}) }}
                  onClick={() => setView("table")}>☰ Table</button>
                <button style={{ ...S.toggleBtn, ...(view === "map" ? S.toggleActive : {}) }}
                  onClick={() => setView("map")}>🗺 Map</button>
              </div>
            </div>
          </div>

          {/* ── STATS ROW ── */}
          <div style={S.statsRow}>
            {[
              { label: "Total Found", val: results.length, color: "#ff6b35" },
              { label: "Filtered", val: filteredResults.length, color: "#818cf8" },
              { label: "With Email", val: filteredResults.filter(r => r.email).length, color: "#34d399" },
              { label: "With Phone", val: filteredResults.filter(r => r.phone).length, color: "#60a5fa" },
              { label: "With Website", val: filteredResults.filter(r => r.website).length, color: "#f59e0b" },
              { label: "Avg Rating", val: (() => {
                const rated = filteredResults.filter(r => ratingNum(r));
                return rated.length ? (rated.reduce((s, r) => s + ratingNum(r), 0) / rated.length).toFixed(1) : "—";
              })(), color: "#fb923c" },
            ].map(({ label, val, color }) => (
              <div key={label} style={S.statCard}>
                <div style={{ ...S.statVal, color }}>{val}</div>
                <div style={S.statLabel}>{label}</div>
              </div>
            ))}
          </div>

          {/* ── TABLE VIEW ── */}
          {view === "table" && (
            <>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {["#", "Business", "Rating", "Reviews", "Category", "Address", "Phone", "Email", "Website"].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedResults.length === 0 ? (
                      <tr><td colSpan={9} style={{ textAlign: "center", padding: "40px", color: "#444" }}>No results match filters</td></tr>
                    ) : pagedResults.map((r, i) => (
                      <tr key={i} style={{ ...S.tr, background: selected?.name === r.name ? "#1a2535" : "transparent", cursor: "pointer" }}
                        onClick={() => handleRowClick(r)}>
                        <td style={{ ...S.td, color: "#444", fontSize: "11px" }}>
                          {(page - 1) * ITEMS_PER_PAGE + i + 1}
                        </td>
                        <td style={{ ...S.td, ...S.tdName }}>
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                            <span style={S.dot} />
                            <div>
                              <div>{r.name || "—"}</div>
                              {r.lat && <div style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>📍 {r.lat}, {r.lng}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={S.td}>
                          {ratingNum(r) ? (
                            <div>
                              <span style={{ color: "#f59e0b", fontWeight: "700" }}>{ratingNum(r)}</span>
                              <div style={{ display: "flex", gap: "1px", marginTop: "2px" }}>
                                {[1,2,3,4,5].map(s => (
                                  <span key={s} style={{ color: s <= Math.round(ratingNum(r)) ? "#f59e0b" : "#2a2a2a", fontSize: "10px" }}>★</span>
                                ))}
                              </div>
                            </div>
                          ) : <span style={{ color: "#333" }}>—</span>}
                        </td>
                        <td style={{ ...S.td, fontSize: "11px", color: "#666" }}>{r.reviews || "—"}</td>
                        <td style={S.td}>
                          {r.category ? <span style={S.catBadge}>{r.category}</span> : <span style={{ color: "#333" }}>—</span>}
                        </td>
                        <td style={{ ...S.td, fontSize: "12px", maxWidth: "170px", color: "#888" }}>{r.address || <span style={{ color: "#333" }}>—</span>}</td>
                        <td style={S.td}>
                          {r.phone
                            ? <a href={`tel:${r.phone}`} style={S.phoneLink} onClick={e => e.stopPropagation()}>{r.phone}</a>
                            : <span style={{ color: "#333" }}>—</span>}
                        </td>
                        <td style={S.td}>
                          {r.email
                            ? <a href={`mailto:${r.email}`} style={S.emailLink} onClick={e => e.stopPropagation()}>{r.email}</a>
                            : <span style={{ color: "#333" }}>—</span>}
                        </td>
                        <td style={S.td}>
                          {r.website
                            ? <a href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                                target="_blank" rel="noreferrer" style={S.webLink} onClick={e => e.stopPropagation()}>
                                {r.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 22)}…
                              </a>
                            : <span style={{ color: "#333" }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── PAGINATION ── */}
              {totalPages > 1 && (
                <div style={S.pagination}>
                  <span style={S.pageInfo}>
                    Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filteredResults.length)} of {filteredResults.length}
                  </span>
                  <div style={S.pageControls}>
                    <button style={{ ...S.pageBtn, opacity: page === 1 ? 0.3 : 1 }}
                      onClick={() => setPage(1)} disabled={page === 1}>«</button>
                    <button style={{ ...S.pageBtn, opacity: page === 1 ? 0.3 : 1 }}
                      onClick={() => setPage(p => p - 1)} disabled={page === 1}>‹</button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                      .reduce((acc, p, idx, arr) => {
                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...");
                        acc.push(p); return acc;
                      }, [])
                      .map((p, i) => p === "..." ? (
                        <span key={`dots-${i}`} style={{ ...S.pageBtn, color: "#444", cursor: "default" }}>…</span>
                      ) : (
                        <button key={p} style={{ ...S.pageBtn, ...(p === page ? S.pageBtnActive : {}) }}
                          onClick={() => setPage(p)}>{p}</button>
                      ))}

                    <button style={{ ...S.pageBtn, opacity: page === totalPages ? 0.3 : 1 }}
                      onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>›</button>
                    <button style={{ ...S.pageBtn, opacity: page === totalPages ? 0.3 : 1 }}
                      onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── MAP VIEW ── */}
          {view === "map" && (
            <div style={S.mapLayout}>
              <div style={S.mapSidebar}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid #1a1a1a", fontSize: "11px", color: "#555" }}>
                  {filteredResults.filter(r => r.lat).length} locations on map
                </div>
                {filteredResults.map((r, i) => (
                  <div key={i} style={{
                    ...S.mapCard,
                    borderLeft: selected?.name === r.name ? "3px solid #ff6b35" : "3px solid transparent",
                    background: selected?.name === r.name ? "#1a2535" : "transparent",
                  }} onClick={() => handleRowClick(r)}>
                    <div style={S.mapCardName}>{r.name}</div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
                      {ratingNum(r) && <span style={{ color: "#f59e0b", fontSize: "11px" }}>★ {ratingNum(r)}</span>}
                      {r.category && <span style={{ color: "#555", fontSize: "11px" }}>{r.category}</span>}
                    </div>
                    {r.address  && <div style={S.mapCardMeta}>📍 {r.address}</div>}
                    {r.phone    && <div style={S.mapCardMeta}>📞 {r.phone}</div>}
                    {r.email    && <div style={{ ...S.mapCardMeta, color: "#34d399" }}>✉ {r.email}</div>}
                    {r.website  && <a href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                        target="_blank" rel="noreferrer" style={S.mapCardWeb}
                        onClick={e => e.stopPropagation()}>🌐 Website ↗</a>}
                    {!r.lat && <div style={{ fontSize: "10px", color: "#333", marginTop: "4px" }}>No coordinates</div>}
                  </div>
                ))}
              </div>
              <div style={S.mapContainer}>
                <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
                {filteredResults.filter(r => r.lat).length === 0 && (
                  <div style={S.noMapMsg}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>📍</div>
                    <div>No coordinates found for these results</div>
                    <div style={{ fontSize: "12px", color: "#444", marginTop: "6px" }}>
                      Coordinates are extracted from Google Maps URLs automatically
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0a; font-family: 'DM Sans', sans-serif; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes progress { 0%{width:4%} 40%{width:60%} 100%{width:88%} }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        select option { background: #1a1a1a; }
        tr:hover > td { background: rgba(255,107,53,0.03) !important; }
        @media (max-width: 768px) {
          #search-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

function ratingNum(r) {
  const m = r?.rating?.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: "100vh", background: "#0a0a0a", color: "#d0d0d0", fontFamily: "'DM Sans', sans-serif", padding: "0 0 80px" },

  topHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px", borderBottom: "1px solid #161616" },
  brand: { display: "flex", alignItems: "center", gap: "8px" },
  brandIcon: { width: "32px", height: "32px", borderRadius: "8px", background: "#161616", border: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "center" },
  brandName: { fontSize: "16px", fontWeight: "700", color: "#fff", letterSpacing: "-0.3px" },
  csvHeaderBtn: { padding: "7px 16px", background: "#ff6b35", border: "none", borderRadius: "7px", color: "#fff", fontWeight: "600", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },

  searchPanel: { maxWidth: "860px", margin: "40px auto", padding: "0 24px" },
  searchTitle: { fontSize: "30px", fontWeight: "700", color: "#fff", letterSpacing: "-0.5px", marginBottom: "6px" },
  searchSub: { fontSize: "14px", color: "#555", marginBottom: "28px" },
  searchGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 130px auto", gap: "14px", alignItems: "end" },
  fieldWrap: { position: "relative" },
  label: { display: "block", fontSize: "12px", fontWeight: "600", color: "#666", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" },
  inputBox: { position: "relative" },
  inputIcon: { position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" },
  input: { width: "100%", padding: "12px 14px 12px 36px", background: "#111", border: "1px solid #222", borderRadius: "10px", color: "#fff", fontSize: "14px", outline: "none", fontFamily: "'DM Sans', sans-serif", transition: "border 0.15s" },
  selectInput: { width: "100%", padding: "12px 32px 12px 36px", background: "#111", border: "1px solid #222", borderRadius: "10px", color: "#fff", fontSize: "14px", outline: "none", fontFamily: "'DM Sans', sans-serif", transition: "border 0.15s", cursor: "pointer", appearance: "none", WebkitAppearance: "none", MozAppearance: "none" },
  searchBtn: { padding: "12px 22px", background: "linear-gradient(135deg, #ff6b35, #ff4500)", border: "none", borderRadius: "10px", color: "#fff", fontWeight: "700", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 20px rgba(255,107,53,0.25)" },
  spinner: { width: "13px", height: "13px", border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" },
  suggestions: { position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#161616", border: "1px solid #222", borderRadius: "10px", zIndex: 100, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" },
  suggItem: { padding: "10px 14px", cursor: "pointer", fontSize: "13px", color: "#ccc", display: "flex", alignItems: "center", gap: "8px", transition: "background 0.1s" },
  queryPreview: { marginTop: "14px", fontSize: "12px", color: "#444", padding: "8px 12px", background: "#111", borderRadius: "6px", border: "1px solid #1a1a1a" },
  progressWrap: { marginTop: "16px" },
  progressBar: { height: "2px", background: "#1a1a1a", borderRadius: "2px", overflow: "hidden" },
  progressFill: { height: "100%", background: "linear-gradient(90deg, #ff6b35, #ff9a5c)", animation: "progress 3s ease-in-out infinite" },
  progressText: { marginTop: "8px", fontSize: "12px", color: "#444", textAlign: "center" },
  errorBox: { marginTop: "14px", padding: "10px 14px", background: "#150d0d", border: "1px solid #3a1515", borderRadius: "8px", color: "#f87171", fontSize: "13px" },

  resultsArea: { maxWidth: "1500px", margin: "0 auto", padding: "0 24px" },

  filterBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", background: "#0f0f0f", border: "1px solid #191919", borderRadius: "12px", marginBottom: "14px", flexWrap: "wrap", gap: "12px" },
  filterLeft: { display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" },
  filterTitle: { fontSize: "12px", fontWeight: "700", color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", display: "flex", alignItems: "center", gap: "6px" },
  filterBadge: { background: "#ff6b35", color: "#fff", borderRadius: "10px", padding: "1px 6px", fontSize: "10px", fontWeight: "700" },
  filterGroup: { display: "flex", alignItems: "center", gap: "8px" },
  filterLabel: { fontSize: "11px", color: "#555", whiteSpace: "nowrap" },
  ratingBtns: { display: "flex", gap: "4px" },
  ratingBtn: { padding: "4px 9px", background: "#161616", border: "1px solid #222", borderRadius: "6px", color: "#666", fontSize: "11px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" },
  ratingBtnActive: { background: "#1a1500", border: "1px solid #f59e0b", color: "#f59e0b" },
  checkFilters: { display: "flex", gap: "14px" },
  checkLabel: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px", color: "#888", userSelect: "none" },
  checkbox: { width: "15px", height: "15px", border: "1px solid #333", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", flexShrink: 0 },
  checkboxActive: { background: "#ff6b35", border: "1px solid #ff6b35" },
  checkmark: { color: "#fff", fontSize: "10px", fontWeight: "700" },
  filterInput: { padding: "5px 10px", background: "#161616", border: "1px solid #222", borderRadius: "6px", color: "#ccc", fontSize: "12px", outline: "none", width: "130px", fontFamily: "'DM Sans', sans-serif" },
  filterRight: { display: "flex", alignItems: "center", gap: "8px" },
  sortSelect: { padding: "6px 10px", background: "#161616", border: "1px solid #222", borderRadius: "7px", color: "#888", fontSize: "12px", outline: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  clearBtn: { padding: "6px 12px", background: "#1a1010", border: "1px solid #3a1a1a", borderRadius: "7px", color: "#f87171", fontSize: "12px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  viewToggle: { display: "flex", background: "#161616", border: "1px solid #222", borderRadius: "8px", overflow: "hidden" },
  toggleBtn: { padding: "6px 13px", border: "none", background: "transparent", color: "#555", fontSize: "12px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" },
  toggleActive: { background: "#222", color: "#fff" },

  statsRow: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "10px", marginBottom: "14px" },
  statCard: { background: "#0f0f0f", border: "1px solid #191919", borderRadius: "10px", padding: "12px 14px" },
  statVal: { fontSize: "22px", fontWeight: "700", letterSpacing: "-0.5px" },
  statLabel: { fontSize: "11px", color: "#444", marginTop: "2px" },

  tableWrap: { overflowX: "auto", border: "1px solid #191919", borderRadius: "12px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: { padding: "10px 14px", textAlign: "left", background: "#0d0d0d", color: "#444", fontWeight: "600", fontSize: "10px", letterSpacing: "0.6px", textTransform: "uppercase", borderBottom: "1px solid #1a1a1a", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #141414", transition: "background 0.1s" },
  td: { padding: "11px 14px", color: "#999", verticalAlign: "middle" },
  tdName: { fontWeight: "600", color: "#e0e0e0", minWidth: "170px" },
  dot: { width: "6px", height: "6px", borderRadius: "50%", background: "#ff6b35", flexShrink: 0, marginTop: "4px" },
  catBadge: { padding: "2px 8px", background: "#0d0d1f", border: "1px solid #1e1e3a", borderRadius: "4px", color: "#6366f1", fontSize: "11px", whiteSpace: "nowrap" },
  phoneLink: { color: "#60a5fa", textDecoration: "none", fontSize: "12px" },
  emailLink: { color: "#34d399", textDecoration: "none", fontSize: "12px" },
  webLink: { color: "#ff6b35", textDecoration: "none", fontSize: "12px" },

  pagination: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 4px", flexWrap: "wrap", gap: "10px" },
  pageInfo: { fontSize: "12px", color: "#444" },
  pageControls: { display: "flex", gap: "4px", alignItems: "center" },
  pageBtn: { width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", background: "#111", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#666", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" },
  pageBtnActive: { background: "#ff6b35", border: "1px solid #ff6b35", color: "#fff", fontWeight: "700" },

  mapLayout: { display: "flex", height: "620px", border: "1px solid #191919", borderRadius: "12px", overflow: "hidden" },
  mapSidebar: { width: "300px", flexShrink: 0, overflowY: "auto", background: "#0d0d0d", borderRight: "1px solid #191919" },
  mapCard: { padding: "12px 14px", cursor: "pointer", borderBottom: "1px solid #141414", transition: "background 0.1s" },
  mapCardName: { fontWeight: "600", color: "#e0e0e0", fontSize: "13px", marginBottom: "4px" },
  mapCardMeta: { fontSize: "11px", color: "#555", marginBottom: "2px" },
  mapCardWeb: { fontSize: "11px", color: "#ff6b35", textDecoration: "none", display: "inline-block", marginTop: "4px" },
  mapContainer: { flex: 1, position: "relative", background: "#0a0a0a" },
  noMapMsg: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#555", fontSize: "14px" },
};
