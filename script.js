// ====== URL "PUBLISH TO WEB" (CSV) ======
// Langsung dari sheet data_kegiatan (baris DELETED otomatis diabaikan lewat kolom Status)
const KEGIATAN_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQmikb8R1h5cr93rKMZSwB5S3g8YRxvlbRXukG3s-Cgl_JDXqH-sbY3RX_IhoeJlv9dq8OKQBlsJN9x/pub?gid=959336537&single=true&output=csv";
// Opsional: CSV daftar nama pegawai (satu kolom Nama). Dikosongkan = jumlah nama dihitung dari data_kegiatan.
const PEGAWAI_CSV_URL = "";
// ===================================================

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const today = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};
const fmtTgl = (s, wd = true) => {
  const [y, m, d] = s.split("-").map(Number);
  return y
    ? new Date(y, m - 1, d).toLocaleDateString("id-ID", {
        ...(wd && { weekday: "short" }),
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Tanggal tidak terbaca";
};

let rows = []; // { nama, tanggal (YYYY-MM-DD), kegiatan, link }
let pegawai = []; // daftar nama unik
let nameFilter = ""; // nama terpilih ('' = semua)

// ---------- CSV ----------
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const out = [];
  let row = [],
    f = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f);
      out.push(row);
      row = [];
      f = "";
    } else f += c;
  }
  if (f !== "" || row.length) {
    row.push(f);
    out.push(row);
  }
  return out;
}

function toISO(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); // dd/mm/yyyy
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : "";
}

function buildRows(csv) {
  const t = parseCSV(csv);
  const head = (t[0] || []).map((h) => h.trim().toLowerCase());
  const [iN, iT, iK, iL, iS] = [
    "nama",
    "tanggal",
    "nama kegiatan",
    "link foto",
    "status",
  ].map((n) => head.indexOf(n));
  if ([iN, iT, iK, iL].includes(-1))
    throw new Error(
      "Kolom CSV harus bernama: Nama, Tanggal, Nama Kegiatan, Link Foto.",
    );
  return t
    .slice(1)
    .filter(
      (r) =>
        r[iN] &&
        r[iN].trim() &&
        (iS < 0 || String(r[iS]).trim().toUpperCase() === "ACTIVE"),
    ) // hanya ACTIVE
    .map((r) => ({
      nama: r[iN].trim(),
      tanggal: toISO(r[iT]),
      kegiatan: (r[iK] || "").trim(),
      link: (r[iL] || "").trim(),
    }));
}

// ---------- Pencarian nama (toleran typo) ----------
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

// skor kecil = lebih cocok, null = tidak cocok
function score(q, name) {
  const n = norm(name);
  const at = n.indexOf(q);
  if (at >= 0) return at / 100;
  const words = n.split(" ");
  let total = 0;
  for (const t of q.split(" ")) {
    let best = Infinity;
    for (const w of words)
      best = Math.min(best, lev(t, w), lev(t, w.slice(0, t.length))); // typo + awalan
    if (best > Math.max(1, Math.floor(t.length / 3))) return null;
    total += best;
  }
  return 1 + total;
}

function findNames(q) {
  q = norm(q);
  if (!q) return pegawai;
  return pegawai
    .map((n) => ({ n, s: score(q, n) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => a.s - b.s || a.n.localeCompare(b.n))
    .map((x) => x.n)
    .slice(0, 10);
}

// ---------- Combobox ----------
const input = $("nama"),
  list = $("opts");
let opts = [],
  active = -1;

function openList() {
  const found = findNames(input.value);
  opts = [""].concat(found);
  const q = norm(input.value);
  list.innerHTML =
    opts
      .map(
        (n, i) =>
          `<li role="option" id="o${i}" data-i="${i}" class="${n === nameFilter ? "sel" : ""}">${n ? esc(n) : "Semua nama"}</li>`,
      )
      .join("") +
    (q && !found.length
      ? '<li class="none">Tidak ada nama yang cocok</li>'
      : "");
  active = q && found.length ? 1 : -1; // Enter langsung memilih hasil teratas
  mark();
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}
function closeList() {
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  input.value = nameFilter; // kembalikan teks ke nama terpilih
}
function mark() {
  list
    .querySelectorAll("li[role=option]")
    .forEach((li, i) => li.classList.toggle("on", i === active));
  if (active >= 0) {
    input.setAttribute("aria-activedescendant", "o" + active);
    const el = $("o" + active);
    if (el) el.scrollIntoView({ block: "nearest" });
  }
}
function pick(i) {
  nameFilter = opts[i] || "";
  input.value = nameFilter;
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  render();
}

input.addEventListener("focus", openList);
input.addEventListener("input", openList);
input.addEventListener("blur", closeList);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (list.hidden) openList();
    active = Math.min(active + 1, opts.length - 1);
    mark();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active = Math.max(active - 1, 0);
    mark();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (!list.hidden && active >= 0) {
      pick(active);
      input.blur();
    }
  } else if (e.key === "Escape") {
    input.blur();
  }
});
list.addEventListener("mousedown", (e) => {
  e.preventDefault(); // jaga fokus agar klik terbaca
  const li = e.target.closest("li[data-i]");
  if (li) {
    pick(+li.dataset.i);
    input.blur();
  }
});

// ---------- Tampilan ----------
const driveId = (l) =>
  (l.match(/\/d\/([\w-]+)/) || l.match(/[?&]id=([\w-]+)/) || [])[1];

function row(r, i) {
  const id = driveId(r.link);
  const ok = /^https?:\/\//.test(r.link);
  const photo = ok
    ? `<div class="fcell">
         <a class="ph" href="${esc(r.link)}" target="_blank" rel="noopener" title="Buka foto di tab baru">${
           id
             ? `<img loading="lazy" alt="Foto ${esc(r.kegiatan)}" src="https://drive.google.com/thumbnail?id=${esc(id)}&sz=w160" onerror="this.replaceWith('Lihat foto')">`
             : "Lihat foto"
         }</a>
         <button type="button" class="cbtn" data-copy="${esc(r.link)}" data-msg="Link foto disalin" aria-label="Salin link foto">Salin</button>
       </div>`
    : '<span class="muted">Tidak ada foto</span>';
  const keg = r.kegiatan
    ? `<div class="cp"><span>${esc(r.kegiatan)}</span><button type="button" class="cbtn" data-copy="${esc(r.kegiatan)}" data-msg="Nama kegiatan disalin" aria-label="Salin nama kegiatan">Salin</button></div>`
    : "";
  return `<tr><td class="c">${i + 1}</td><td class="nw">${esc(fmtTgl(r.tanggal, false))}</td><td>${esc(r.nama)}</td><td>${keg}</td><td>${photo}</td></tr>`;
}

// ---------- Salin ke clipboard ----------
async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    // cadangan untuk browser/koneksi tanpa Clipboard API
    const a = document.createElement("textarea");
    a.value = t;
    a.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(a);
    a.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {}
    a.remove();
    return ok;
  }
}
let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1800);
}
$("grid").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const ok = await copyText(b.dataset.copy);
  toast(ok ? b.dataset.msg || "Tersalin" : "Gagal menyalin. Salin manual.");
  if (ok && b.classList.contains("cbtn")) {
    const old = b.textContent;
    b.textContent = "Tersalin";
    setTimeout(() => (b.textContent = old), 1500);
  }
});

function render() {
  const d = $("tgl").value;
  const shown = rows
    .filter(
      (r) =>
        (!nameFilter || norm(r.nama) === norm(nameFilter)) &&
        (!d || r.tanggal === d),
    )
    .sort(
      (a, b) =>
        b.tanggal.localeCompare(a.tanggal) || a.nama.localeCompare(b.nama),
    );
  $("count").textContent =
    `${shown.length} kegiatan ditampilkan` +
    (d ? ` untuk ${fmtTgl(d)}` : " (semua tanggal)") +
    (nameFilter ? ` · ${nameFilter}` : "");
  $("grid").innerHTML = shown.length
    ? shown.map(row).join("")
    : '<tr><td colspan="5" class="empty">Tidak ada kegiatan untuk filter ini.</td></tr>';
}

function renderStats() {
  const t = today();
  const todayRows = rows.filter((r) => r.tanggal === t);
  const names = pegawai.length
    ? pegawai
    : [...new Set(rows.map((r) => r.nama))];
  const reported = new Set(todayRows.map((r) => norm(r.nama)));
  const done = names.filter((n) => reported.has(norm(n))).length;
  $("sTotal").textContent = rows.length;
  $("sToday").textContent = todayRows.length;
  $("sNames").textContent = names.length;
  $("sReported").textContent = done;
  $("sPending").textContent =
    `dari ${names.length} nama · belum: ${names.length - done}`;
}

// ---------- Ambil data ----------
async function getCSV(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

async function load() {
  const btn = $("reload");
  btn.disabled = true;
  $("msg").textContent = "";
  $("msg").className = "msg";
  try {
    if (KEGIATAN_CSV_URL.includes("/ISI/"))
      throw new Error("URL CSV belum diisi di script.js.");
    const [k, p] = await Promise.all([
      getCSV(KEGIATAN_CSV_URL),
      PEGAWAI_CSV_URL && !PEGAWAI_CSV_URL.includes("/ISI/")
        ? getCSV(PEGAWAI_CSV_URL)
        : Promise.resolve(""),
    ]);
    rows = buildRows(k);
    pegawai = [
      ...new Set(
        parseCSV(p)
          .slice(1)
          .map((r) => (r[0] || "").trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));
    if (!pegawai.length)
      pegawai = [...new Set(rows.map((r) => r.nama))].sort((a, b) =>
        a.localeCompare(b),
      ); // tanpa CSV pegawai: nama diambil dari data_kegiatan
    const now = new Date();
    $("updated").textContent =
      `Data diambil pukul ${pad(now.getHours())}.${pad(now.getMinutes())}. Google memperbarui CSV sekitar tiap 5 menit.`;
    renderStats();
    render();
  } catch (err) {
    $("updated").textContent = "Gagal memuat data.";
    $("msg").textContent = err.message;
    $("msg").className = "msg error";
  } finally {
    btn.disabled = false;
  }
}

$("tgl").value = today(); // default: hari yang sedang berjalan
$("tgl").addEventListener("change", render);
$("btnToday").addEventListener("click", () => {
  $("tgl").value = today();
  render();
});
$("btnAll").addEventListener("click", () => {
  $("tgl").value = "";
  render();
});
$("reload").addEventListener("click", load);
load();
