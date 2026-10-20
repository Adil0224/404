const definitions = {
  doctors: {
    label: "Дәрігерлер", path: "admin/doctors", list: "doctors",
    fields: [
      ["code", "Код (мысалы aidos)", "text", true],
      ["fullName", "Аты-жөні", "text", true],
      ["specialty", "Мамандығы", "text", true],
      ["description", "Қысқаша ақпарат", "textarea", false],
      ["experienceYears", "Тәжірибесі (жыл)", "number", true]
    ],
    values: item => [item.code, item.fullName, item.specialty, item.description, item.experienceYears],
    title: item => item.fullName,
    summary: item => item.specialty + " · " + item.experienceYears + " жыл тәжірибе"
  },
  branches: {
    label: "Филиалдар", path: "admin/branches", list: "branches",
    fields: [
      ["code", "Код (мысалы naz)", "text", true],
      ["name", "Филиал атауы", "text", true],
      ["address", "Мекенжайы", "text", true],
      ["mapUrl", "Карта сілтемесі", "url", false]
    ],
    values: item => [item.code, item.name, item.address, item.mapUrl || ""],
    title: item => item.name,
    summary: item => item.address
  },
  services: {
    label: "Қызметтер мен бағалар", path: "admin/services", list: "services",
    fields: [
      ["code", "Код (мысалы therapist)", "text", true],
      ["name", "Қызмет атауы", "text", true],
      ["priceKzt", "Бағасы (₸)", "number", true],
      ["durationMinutes", "Ұзақтығы (минут)", "number", true]
    ],
    values: item => [item.code, item.name, item.priceKzt, item.durationMinutes],
    title: item => item.name,
    summary: item => item.priceKzt + " ₸ · " + item.durationMinutes + " минут"
  },
  schedules: {
    label: "Жұмыс кестесі", path: "admin/schedules", list: "admin/schedules",
    fields: [
      ["doctorId", "Дәрігер", "doctor", true],
      ["branchId", "Филиал", "branch", true],
      ["weekday", "Апта күні (0 — жексенбі, 1 — дүйсенбі)", "number", true],
      ["startsAt", "Басталу уақыты", "time", true],
      ["endsAt", "Аяқталу уақыты", "time", true],
      ["slotMinutes", "Қабылдау аралығы (минут)", "number", true]
    ],
    values: item => [item.doctorId, item.branchId, item.weekday, String(item.startsAt).slice(0, 5), String(item.endsAt).slice(0, 5), item.slotMinutes],
    title: item => item.doctorName,
    summary: item => item.branchName + " · " + item.weekday + "-күн · " + String(item.startsAt).slice(0, 5) + "–" + String(item.endsAt).slice(0, 5)
  }
};

let token = "";
let currentResource = "doctors";
let editingId = "";
let cachedDoctors = [];
let cachedBranches = [];
const $ = selector => document.querySelector(selector);
const form = $("#record-form");

function apiBase() {
  return $("#api-url").value.trim().replace(/\/$/, "");
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: "Bearer " + token } : {})
  };
  const response = await fetch(apiBase() + "/api/" + path, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Сұрауды орындау мүмкін болмады.");
  return result;
}

function setStatus(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

function buildFields() {
  const definition = definitions[currentResource];
  $("#form-title").textContent = (editingId ? "Өзгерту: " : "Қосу: ") + definition.label;
  form.replaceChildren();
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "id";
  hidden.value = editingId;
  form.append(hidden);
  for (const [name, label, type, required] of definition.fields) {
    const fieldLabel = document.createElement("label");
    fieldLabel.htmlFor = "field-" + name;
    fieldLabel.textContent = label;
    const input = type === "textarea"
      ? document.createElement("textarea")
      : document.createElement(type === "doctor" || type === "branch" ? "select" : "input");
    input.id = "field-" + name;
    input.name = name;
    input.required = required;
    if (type === "number") {
      input.type = "number";
      input.min = name === "weekday" ? "0" : "0";
      input.max = name === "weekday" ? "6" : "100000";
      input.step = "1";
    } else if (type === "time") {
      input.type = "time";
    } else if (!["textarea", "doctor", "branch"].includes(type)) {
      input.type = type;
    }
    if (type === "doctor" || type === "branch") {
      const choices = type === "doctor" ? cachedDoctors : cachedBranches;
      input.add(new Option("Таңдаңыз", ""));
      choices.forEach(item => input.add(new Option(type === "doctor" ? item.fullName : item.name, item.id)));
    }
    form.append(fieldLabel, input);
  }
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = editingId ? "Өзгерісті сақтау" : "Қосу";
  form.append(save);
}

function resetForm() {
  editingId = "";
  buildFields();
  $("#cancel-edit").hidden = true;
}

function beginEdit(item) {
  editingId = item.id;
  buildFields();
  const values = definitions[currentResource].values(item);
  definitions[currentResource].fields.forEach(([name], index) => {
    const input = form.elements.namedItem(name);
    if (input) input.value = values[index] ?? "";
  });
  $("#cancel-edit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderRecords(items) {
  const box = $("#records");
  box.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Әзірге дерек жоқ.";
    box.append(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "record";
    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = definitions[currentResource].title(item);
    const summary = document.createElement("p");
    summary.textContent = definitions[currentResource].summary(item);
    details.append(title, summary);
    const actions = document.createElement("div");
    actions.className = "record-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Өзгерту";
    edit.addEventListener("click", () => beginEdit(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "Өшіру";
    remove.addEventListener("click", () => deactivate(item.id));
    actions.append(edit, remove);
    card.append(details, actions);
    box.append(card);
  }
}

async function loadResources() {
  const [doctors, branches] = await Promise.all([api("doctors"), api("branches")]);
  cachedDoctors = doctors.data;
  cachedBranches = branches.data;
}

async function loadRecords() {
  setStatus($("#admin-status"), "Деректер жүктеліп жатыр…");
  try {
    if (currentResource === "schedules") {
      await loadResources();
      if (!editingId) buildFields();
    }
    const definition = definitions[currentResource];
    const result = await api(definition.list);
    renderRecords(result.data);
    $("#list-title").textContent = definition.label + " тізімі";
    setStatus($("#admin-status"), "Жаңартылды.");
  } catch (error) {
    setStatus($("#admin-status"), error.message, true);
  }
}

async function deactivate(id) {
  if (!window.confirm("Осы жазбаны уақытша өшіресіз бе?")) return;
  try {
    await api(definitions[currentResource].path + "/" + id, { method: "DELETE" });
    setStatus($("#admin-status"), "Жазба өшірілді.");
    if (editingId === id) resetForm();
    await loadRecords();
  } catch (error) {
    setStatus($("#admin-status"), error.message, true);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const id = data.id;
  delete data.id;
  for (const key of ["experienceYears", "priceKzt", "durationMinutes", "weekday", "slotMinutes"]) {
    if (data[key] !== undefined) data[key] = Number(data[key]);
  }
  try {
    const path = definitions[currentResource].path + (id ? "/" + id : "");
    await api(path, { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    setStatus($("#admin-status"), id ? "Өзгеріс сақталды." : "Жазба қосылды.");
    resetForm();
    await loadRecords();
  } catch (error) {
    setStatus($("#admin-status"), error.message, true);
  }
});

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("#login-status");
  setStatus(status, "Тексеріліп жатыр…");
  try {
    const result = await api("auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier: $("#login-identifier").value.trim(),
        password: $("#login-password").value
      })
    });
    if (result.user.role !== "admin") {
      token = result.token;
      await api("auth/logout", { method: "POST" });
      token = "";
      throw new Error("Бұл тіркелгіде әкімші рөлі жоқ.");
    }
    token = result.token;
    $("#admin-user").textContent = result.user.fullName;
    $("#login-card").hidden = true;
    $("#admin-app").hidden = false;
    await loadResources();
    resetForm();
    await loadRecords();
  } catch (error) {
    token = "";
    setStatus(status, error.message, true);
  }
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("auth/logout", { method: "POST" }); } catch {}
  token = "";
  $("#admin-app").hidden = true;
  $("#login-card").hidden = false;
  $("#login-password").value = "";
});

$("#refresh-button").addEventListener("click", loadRecords);
$("#cancel-edit").addEventListener("click", resetForm);
document.querySelectorAll("[data-resource]").forEach(button => {
  button.addEventListener("click", async () => {
    currentResource = button.dataset.resource;
    document.querySelectorAll("[data-resource]").forEach(item => item.classList.toggle("active", item === button));
    resetForm();
    await loadRecords();
  });
});

buildFields();
