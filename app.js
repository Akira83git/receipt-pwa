const GROUPS = [
  { id: "red", label: "赤", color: "#e65a56" },
  { id: "blue", label: "青", color: "#4f83cc" },
  { id: "yellow", label: "黄", color: "#e7b93f" },
  { id: "green", label: "緑", color: "#52a36d" },
];

const els = Object.fromEntries([
  "receipt-input", "preview", "scan-button", "progress-wrap", "progress",
  "status", "assignment", "colors", "items", "live-totals",
].map(id => [id, document.getElementById(id)]));

let imageFile;
let activeGroup = GROUPS[0].id;
let items = [];

els.colors.innerHTML = GROUPS.map((group, index) => `
  <button class="color-button ${index === 0 ? "active" : ""}" type="button"
    data-group="${group.id}" style="--group-color:${group.color}" aria-label="${group.label}"></button>
`).join("");

els["receipt-input"].addEventListener("change", event => {
  imageFile = event.target.files[0];
  if (!imageFile) return;
  els.preview.src = URL.createObjectURL(imageFile);
  els.preview.hidden = false;
  els["scan-button"].disabled = false;
  els.assignment.hidden = true;
});

els.colors.addEventListener("click", event => {
  const button = event.target.closest("[data-group]");
  if (!button) return;
  activeGroup = button.dataset.group;
  document.querySelectorAll(".color-button").forEach(el => el.classList.toggle("active", el === button));
});

els.items.addEventListener("click", event => {
  const button = event.target.closest("[data-assign-id]");
  if (!button) return;
  const item = items.find(entry => entry.id === Number(button.dataset.assignId));
  item.group = item.group === activeGroup ? null : activeGroup;
  renderItems();
});

els.items.addEventListener("input", event => {
  const nameInput = event.target.closest("[data-name-id]");
  if (nameInput) {
    const item = items.find(entry => entry.id === Number(nameInput.dataset.nameId));
    if (item) item.name = nameInput.value;
    return;
  }
  const input = event.target.closest("[data-price-id]");
  if (!input) return;
  const item = items.find(entry => entry.id === Number(input.dataset.priceId));
  const value = Number(input.value);
  if (item && Number.isFinite(value) && value >= 0) item.price = value;
  renderLiveTotals();
});

els.items.addEventListener("change", event => {
  const input = event.target.closest("[data-price-id]");
  if (!input) return;
  const item = items.find(entry => entry.id === Number(input.dataset.priceId));
  if (!item) return;
  input.value = item.price.toFixed(2);
});

els["scan-button"].addEventListener("click", scanReceipt);

async function scanReceipt() {
  if (!imageFile) return;
  if (!window.Tesseract) {
    alert("OCRを読み込めませんでした。初回だけ通信環境で開いてください。");
    return;
  }
  setBusy(true, "OCRを準備中…", 0);
  try {
    const source = await resizeImage(imageFile);
    const result = await Tesseract.recognize(source, "eng", {
      logger: message => {
        if (typeof message.progress === "number") {
          setBusy(true, message.status === "recognizing text" ? "文字を読み取り中…" : "OCRを準備中…", message.progress);
        }
      },
    });
    items = extractReceiptLines(result.data.text);
    if (!items.length) throw new Error("金額候補を見つけられませんでした。明るい場所で正面から撮り直してください。");
    renderItems();
    els.assignment.hidden = false;
    els.assignment.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    alert(error.message || "読み取りに失敗しました。");
  } finally {
    setBusy(false);
  }
}

function extractReceiptLines(text) {
  const priceAtEnd = /(?:\$\s*)?(-?\d{1,5}[.,]\d{2})\s*$/;
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap((line, id) => {
    const match = line.match(priceAtEnd);
    if (!match) return [];
    const name = line.slice(0, match.index).replace(/[.$\s]+$/, "").trim();
    if (!name) return [];
    const price = Number(match[1].replace(",", "."));
    return Number.isFinite(price) ? [{ id, name, price, group: null }] : [];
  });
}

function renderItems() {
  els.items.innerHTML = items.map(item => {
    const group = GROUPS.find(entry => entry.id === item.group);
    return `<div class="item ${group ? "assigned" : ""}"
      style="--group-color:${group?.color || "#b7b0a6"}">
      <div class="item-main">
        <button class="item-select" type="button" data-assign-id="${item.id}" aria-label="色を付ける">
          <span class="item-dot"></span>
        </button>
        <input class="name-edit" type="text" value="${escapeAttr(item.name)}" data-name-id="${item.id}" aria-label="商品名">
      </div>
      <label class="price-edit">$<input type="number" inputmode="decimal" min="0" step="0.01"
        value="${item.price.toFixed(2)}" data-price-id="${item.id}" aria-label="金額"></label>
    </div>`;
  }).join("");
  renderLiveTotals();
}

function getGroupTotals() {
  return GROUPS.map(group => ({
    ...group,
    count: items.filter(item => item.group === group.id).length,
    total: items.filter(item => item.group === group.id).reduce((sum, item) => sum + item.price, 0),
  }));
}

function renderLiveTotals() {
  const selectedRows = getGroupTotals().filter(row => row.count > 0);
  els["live-totals"].innerHTML = selectedRows.length ? selectedRows.map(row => `<div class="live-row" style="--group-color:${row.color}">
    <span class="live-dot"></span><span class="sr-only">${row.label}</span><span></span><strong>$${row.total.toFixed(2)}</strong>
  </div>`).join("") : `<p class="empty-total">まだ色分けされていません</p>`;
}

function setBusy(busy, status = "", progress = 0) {
  els["progress-wrap"].hidden = !busy;
  els["scan-button"].disabled = busy || !imageFile;
  els.status.textContent = status;
  els.progress.value = progress;
}

async function resizeImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
