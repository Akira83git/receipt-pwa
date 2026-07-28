const GROUPS = [
  { id: "red", label: "赤", color: "#e65a56" },
  { id: "blue", label: "青", color: "#4f83cc" },
  { id: "yellow", label: "黄", color: "#e7b93f" },
  { id: "green", label: "緑", color: "#52a36d" },
];

const els = Object.fromEntries([
  "receipt-input", "preview", "scan-button", "progress-wrap", "progress",
  "status", "assignment", "colors", "items", "live-totals", "wheel-modal",
  "wheel-backdrop", "wheel-cancel", "wheel-done", "wheel-value", "integer-wheel", "decimal-wheel",
].map(id => [id, document.getElementById(id)]));

let imageFile;
let activeGroup = GROUPS[0].id;
let items = [];
let editingItem = null;
let wheelInteger = 0;
let wheelDecimal = 0;
let wheelNegative = false;

els["integer-wheel"].innerHTML = Array.from({ length: 1999 }, (_, index) => index - 999).map(value =>
  `<div class="wheel-option" data-value="${value}">${value}</div>`).join("");
els["decimal-wheel"].innerHTML = Array.from({ length: 100 }, (_, value) =>
  `<div class="wheel-option" data-value="${value}">${String(value).padStart(2, "0")}</div>`).join("");

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
    autoResizeName(nameInput);
    return;
  }
});

els.items.addEventListener("click", event => {
  const priceButton = event.target.closest("[data-price-id]");
  if (!priceButton) return;
  openWheel(Number(priceButton.dataset.priceId));
});

els["integer-wheel"].addEventListener("scroll", () => updateWheelFromScroll("integer"), { passive: true });
els["decimal-wheel"].addEventListener("scroll", () => updateWheelFromScroll("decimal"), { passive: true });
els["wheel-cancel"].addEventListener("click", closeWheel);
els["wheel-backdrop"].addEventListener("click", closeWheel);
els["wheel-done"].addEventListener("click", () => {
  if (editingItem) {
    const absoluteValue = Math.abs(wheelInteger) + wheelDecimal / 100;
    editingItem.price = wheelNegative ? -absoluteValue : absoluteValue;
  }
  closeWheel();
  renderItems();
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
        <textarea class="name-edit" rows="1" data-name-id="${item.id}" aria-label="商品名">${escapeHtml(item.name)}</textarea>
      </div>
      <button class="price-edit" type="button" data-price-id="${item.id}" aria-label="金額を修正">
        $${item.price.toFixed(2)}</button>
    </div>`;
  }).join("");
  els.items.querySelectorAll(".name-edit").forEach(autoResizeName);
  renderLiveTotals();
}

function autoResizeName(field) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
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

function openWheel(itemId) {
  editingItem = items.find(item => item.id === itemId);
  if (!editingItem) return;
  const absolutePrice = Math.abs(editingItem.price);
  wheelNegative = editingItem.price < 0;
  wheelInteger = Math.min(999, Math.max(-999, (wheelNegative ? -1 : 1) * Math.floor(absolutePrice)));
  wheelDecimal = Math.min(99, Math.max(0, Math.round((absolutePrice - Math.floor(absolutePrice)) * 100)));
  els["wheel-modal"].hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    els["integer-wheel"].scrollTop = (wheelInteger + 999) * 44;
    els["decimal-wheel"].scrollTop = wheelDecimal * 44;
    updateWheelValue();
  });
}

function closeWheel() {
  els["wheel-modal"].hidden = true;
  document.body.classList.remove("modal-open");
  editingItem = null;
}

function updateWheelFromScroll(type) {
  const wheel = type === "integer" ? els["integer-wheel"] : els["decimal-wheel"];
  const value = type === "integer"
    ? Math.min(999, Math.max(-999, Math.round(wheel.scrollTop / 44) - 999))
    : Math.min(99, Math.max(0, Math.round(wheel.scrollTop / 44)));
  if (type === "integer") {
    wheelInteger = value;
    if (value !== 0) wheelNegative = value < 0;
  }
  else wheelDecimal = value;
  updateWheelValue();
}

function updateWheelValue() {
  const sign = wheelNegative ? "-" : "";
  els["wheel-value"].textContent = `${sign}${Math.abs(wheelInteger)}.${String(wheelDecimal).padStart(2, "0")}`;
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
