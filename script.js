const doctors = {
  therapist: {
    name: "Терапевт",
    days: [1, 2, 3, 4, 5],
    start: 9,
    end: 17
  },
  cardiologist: {
    name: "Кардиолог",
    days: [1, 2, 3, 4],
    start: 10,
    end: 16
  },
  pediatrician: {
    name: "Педиатр",
    days: [1, 2, 3, 4, 5],
    start: 9,
    end: 15
  }
};

const doctorSelect = document.querySelector("#doctor");
const dateInput = document.querySelector("#appointment-date");
const timeSelect = document.querySelector("#appointment-time");
const bookingForm = document.querySelector("#booking-form");
const formMessage = document.querySelector("#form-message");

const storageKey = "clinic-reserved-times";

function getReservations() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function setMessage(text, isError = false) {
  formMessage.textContent = text;
  formMessage.hidden = false;
  formMessage.classList.toggle("error", isError);
}

function addPlaceholder(select, text) {
  select.innerHTML = "";
  const option = document.createElement("option");
  option.value = "";
  option.textContent = text;
  select.append(option);
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadDoctors() {
  addPlaceholder(doctorSelect, "Маманды таңдаңыз");

  Object.entries(doctors).forEach(([id, doctor]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = doctor.name;
    doctorSelect.append(option);
  });

  addPlaceholder(timeSelect, "Алдымен дәрігер мен күнді таңдаңыз");
}

function updateAvailableTimes() {
  const doctorId = doctorSelect.value;
  const date = dateInput.value;

  addPlaceholder(timeSelect, "Бос уақытты таңдаңыз");

  if (!doctorId || !date) {
    return;
  }

  const doctor = doctors[doctorId];
  const selectedDay = new Date(`${date}T12:00:00`).getDay();

  if (!doctor.days.includes(selectedDay)) {
    addPlaceholder(timeSelect, "Бұл күні дәрігер қабылдамайды");
    return;
  }

  const reservations = getReservations();
  let availableCount = 0;

  for (let hour = doctor.start; hour < doctor.end; hour += 1) {
    for (const minute of [0, 30]) {
      const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const alreadyReserved = reservations.some(
        (item) =>
          item.doctor === doctorId &&
          item.date === date &&
          item.time === time
      );

      if (!alreadyReserved) {
        const option = document.createElement("option");
        option.value = time;
        option.textContent = time;
        timeSelect.append(option);
        availableCount += 1;
      }
    }
  }

  if (availableCount === 0) {
    addPlaceholder(timeSelect, "Бос уақыт жоқ");
  }
}

dateInput.min = getLocalDateString(new Date());
loadDoctors();

doctorSelect.addEventListener("change", updateAvailableTimes);
dateInput.addEventListener("change", updateAvailableTimes);

document.querySelectorAll(".choose-doctor").forEach((button) => {
  button.addEventListener("click", () => {
    doctorSelect.value = button.dataset.doctor;
    updateAvailableTimes();
    document.querySelector("#booking").scrollIntoView({ behavior: "smooth" });
  });
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!bookingForm.reportValidity()) {
    return;
  }

  const doctor = doctorSelect.value;
  const date = dateInput.value;
  const time = timeSelect.value;

  if (!time) {
    setMessage("Қабылдау уақытын таңдаңыз.", true);
    return;
  }

  const reservations = getReservations();
  const alreadyReserved = reservations.some(
    (item) =>
      item.doctor === doctor &&
      item.date === date &&
      item.time === time
  );

  if (alreadyReserved) {
    setMessage("Бұл уақыт бос емес. Басқа уақытты таңдаңыз.", true);
    updateAvailableTimes();
    return;
  }

  reservations.push({ doctor, date, time });
  localStorage.setItem(storageKey, JSON.stringify(reservations));

  const doctorName = doctors[doctor].name;
  setMessage(
    `Үлгі жазылу сақталды: ${date}, ${time}, ${doctorName}. Бұл дерек емханаға жіберілген жоқ.`
  );

  updateAvailableTimes();
});