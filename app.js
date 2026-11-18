/**
 * Логика веб-приложения для нормирования стимулов по протоколу OASIS (Kurdi et al., 2017)
 * Версия с:
 * 1. Проверкой подключения к Google Таблицам на старте (с подсказкой про режим Инкогнито).
 * 2. Пакетной отправкой данных блоками (после 30-й и 60-й картинки) с credentials: "omit".
 * 3. Автоматической резервной отправкой таблицы на почту исследователя через Web3Forms, если Google Таблица не приняла блок.
 */

const VALENCE_LABELS = {
  1: "Очень негативная",
  2: "Умеренно негативная",
  3: "Слегка негативная",
  4: "Нейтральная",
  5: "Слегка позитивная",
  6: "Умеренно позитивная",
  7: "Очень позитивная"
};

const AROUSAL_LABELS = {
  1: "Очень низкое",
  2: "Умеренно низкое",
  3: "Слегка низкое",
  4: "Умеренное",
  5: "Слегка высокое",
  6: "Умеренно высокое",
  7: "Очень высокое"
};

const STORAGE_KEYS = {
  SESSION: "oasis_active_session_v4",
  COMPLETED: "oasis_is_completed_v4",
  LOCAL_COUNTERS: "oasis_local_counters_v4",
  LOCAL_RESPONSES: "oasis_local_responses_v4",
  PENDING_BATCHES: "oasis_pending_batches_v4"
};

const DEFAULT_FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%232C3E50'/></svg>";
const ALERT_FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23dc2626'/></svg>";
const DEFAULT_TITLE = "Исследование восприятия изображений (OASIS)";

// Состояние текущего предъявления
let currentSession = null;
let currentValence = null;
let currentArousal = null;
let tStart = 0;
let rtFirstClickMs = null;
let minTimeElapsed = false;
let minViewTimerId = null;
let breakIntervalId = null;
let titleBlinkIntervalId = null;
let audioCtx = null;
let isSubmittingBlock = false;

// Параметры URL (?test=1 и ?fast=1)
const urlParams = new URLSearchParams(window.location.search);
const isUrlTestMode = urlParams.get("test") === "1";
const isUrlFastMode = urlParams.get("fast") === "1";

/**
 * Надежное определение смартфонов и планшетов (включая iPad с iPadOS 13+, который маскируется под Mac в User-Agent)
 * Настоящие Mac (MacBook / iMac) в Safari имеют navigator.maxTouchPoints === 0 и спокойно проходят проверку.
 */
function isMobileOrTabletDevice() {
  if (isUrlTestMode) {
    return false;
  }

  const ua = navigator.userAgent || "";
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
  const isIPadOS = (navigator.platform === "MacIntel" || /Macintosh/i.test(ua)) && navigator.maxTouchPoints > 1;
  const isSmallTouchScreen = window.matchMedia("(pointer: coarse)").matches && Math.min(window.screen.width, window.screen.height) < 900;

  return isMobileUA || isIPadOS || isSmallTouchScreen;
}

document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  restoreOrInitApp();
});

/**
 * Формирование списка кандидатов путей для картинки с учетом подпапок group_1 / group_2
 * и автоматического перебора расширений (.jpg / .jpeg)
 */
function getCandidateImagePaths(trialObj) {
  const fileName = trialObj.imageName;
  const folder = trialObj.group === "A" ? "group_1" : "group_2";
  const baseName = fileName.replace(/\.(jpeg|jpg)$/i, "");
  const encodedJpg = encodeURIComponent(baseName + ".jpg");
  const encodedJpeg = encodeURIComponent(baseName + ".jpeg");

  const paths = [
    `images/${folder}/${encodedJpg}`,
    `images/${folder}/${encodedJpeg}`,
    `images/${encodedJpg}`,
    `images/${encodedJpeg}`
  ];

  if (/Gorrila/i.test(baseName)) {
    const altBase = baseName.replace(/Gorrila/i, "Gorilla");
    paths.push(`images/${folder}/${encodeURIComponent(altBase + ".jpg")}`);
    paths.push(`images/${folder}/${encodeURIComponent(altBase + ".jpeg")}`);
  }

  return paths;
}

/**
 * Инициализация всех обработчиков событий
 */
function initEventListeners() {
  const btnTestSound = document.getElementById("btn-test-sound");
  if (btnTestSound) {
    btnTestSound.addEventListener("click", () => {
      playDoubleBeep();
    });
  }

  const startForm = document.getElementById("start-form");
  if (startForm) {
    startForm.addEventListener("submit", handleStartSubmit);
  }

  const scaleButtons = document.querySelectorAll(".scale-btn");
  scaleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const scale = btn.getAttribute("data-scale");
      const value = parseInt(btn.getAttribute("data-value"), 10);
      handleScaleSelect(scale, value);
    });
  });

  const tooltipTriggers = document.querySelectorAll(".tooltip-trigger");
  tooltipTriggers.forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrapper = trigger.closest(".tooltip-wrapper");
      const isOpen = wrapper.classList.contains("open");
      document.querySelectorAll(".tooltip-wrapper.open").forEach((w) => w.classList.remove("open"));
      if (!isOpen) {
        wrapper.classList.add("open");
      }
    });
  });

  document.addEventListener("click", () => {
    document.querySelectorAll(".tooltip-wrapper.open").forEach((w) => w.classList.remove("open"));
  });

  const btnNext = document.getElementById("btn-next");
  if (btnNext) {
    btnNext.addEventListener("click", handleNextTrial);
  }

  const btnContinue = document.getElementById("btn-continue");
  if (btnContinue) {
    btnContinue.addEventListener("click", handleBreakContinue);
  }

  const btnDownloadCsv = document.getElementById("btn-download-csv");
  if (btnDownloadCsv) {
    btnDownloadCsv.addEventListener("click", downloadLocalCsv);
  }

  const btnAdminReset = document.getElementById("btn-admin-reset");
  if (btnAdminReset) {
    btnAdminReset.addEventListener("click", resetProgressToIntro);
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "Backspace") {
      e.preventDefault();
      resetProgressToIntro();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      stopTabBlinking();
    }
  });
  window.addEventListener("focus", () => {
    stopTabBlinking();
  });
}

/**
 * Сброс текущего прогресса и возврат на стартовый экран с инструкцией (для исследователя)
 */
function resetProgressToIntro() {
  if (minViewTimerId) {
    clearTimeout(minViewTimerId);
    minViewTimerId = null;
  }
  if (breakIntervalId) {
    clearInterval(breakIntervalId);
    breakIntervalId = null;
  }
  stopTabBlinking();
  currentSession = null;
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  localStorage.removeItem(STORAGE_KEYS.COMPLETED);
  showScreen("screen-intro");
}

/**
 * Восстановление незавершенной сессии при перезагрузке или показ стартового экрана
 */
async function restoreOrInitApp() {
  if (isMobileOrTabletDevice()) {
    showScreen("screen-mobile-block");
    return;
  }

  if (isUrlTestMode) {
    const saved = loadSession();
    if (saved && saved.isAdminTest && !saved.isFinished) {
      currentSession = saved;
      resumeSessionState();
      return;
    }
    showScreen("screen-intro");
    return;
  }

  const savedSession = loadSession();
  if (savedSession && !savedSession.isFinished) {
    currentSession = savedSession;
    resumeSessionState();
    return;
  }

  showScreen("screen-intro");
}

/**
 * Продолжение сохраненной сессии с нужного шага (Экран 2 или Экран 3)
 */
function resumeSessionState() {
  if (!currentSession) return;

  if (currentSession.inBreak) {
    showBreakScreen();
  } else if (currentSession.currentIndex >= 60) {
    finishExperiment();
  } else {
    showScreen("screen-stimulus");
    preloadImagesFrom(currentSession.currentIndex, 3);
    renderCurrentTrial();
  }
}

/**
 * Обработка нажатия «Начать исследование» с обязательной предварительной проверкой связи с Google Таблицей
 */
async function handleStartSubmit(event) {
  event.preventDefault();

  if (isMobileOrTabletDevice()) {
    showScreen("screen-mobile-block");
    return;
  }

  const genderInput = document.querySelector('input[name="gender"]:checked');
  const ageInput = document.getElementById("age-input");
  const errorBox = document.getElementById("form-error");

  const defaultErrorText = "Пожалуйста, укажите ваш пол и корректный возраст (от 18 до 100 лет).";
  errorBox.textContent = defaultErrorText;

  const gender = genderInput ? genderInput.value : "";
  const age = ageInput ? parseInt(ageInput.value, 10) : NaN;

  if (!gender || isNaN(age) || age < 18 || age > 100) {
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;

  const isAdminTest = (age === 100 || isUrlTestMode);

  // Защита от повторного прохождения для обычных участников (возраст 18–99)
  if (!isAdminTest && localStorage.getItem(STORAGE_KEYS.COMPLETED) === "true") {
    showFinalScreen();
    return;
  }

  const btnStart = document.getElementById("btn-start");
  btnStart.disabled = true;
  btnStart.textContent = "Проверка подключения к базе...";

  try {
    // 1. Строгая проверка подключения к Google Таблице перед стартом.
    // Если расширение браузера блокирует доступ — выводим подсказку про режим Инкогнито и не запускаем тест вхолостую.
    const counts = await getGroupCountersStrict();

    let firstGroup;
    if (counts.countA < counts.countB) {
      firstGroup = "A";
    } else if (counts.countB < counts.countA) {
      firstGroup = "B";
    } else {
      firstGroup = Math.random() < 0.5 ? "A" : "B";
    }
    const secondGroup = firstGroup === "A" ? "B" : "A";

    // Перемешиваем 30 картинок внутри каждой группы алгоритмом Фишера — Йетса
    const shuffledA = shuffleArray([...CONFIG.GROUP_A]);
    const shuffledB = shuffleArray([...CONFIG.GROUP_B]);

    const firstList = firstGroup === "A" ? shuffledA : shuffledB;
    const secondList = secondGroup === "A" ? shuffledA : shuffledB;

    const trials = [
      ...firstList.map((img) => ({ imageName: img, group: firstGroup })),
      ...secondList.map((img) => ({ imageName: img, group: secondGroup }))
    ];

    const participantId = isAdminTest
      ? "Тест_админа"
      : `P_${Math.floor(Date.now() / 1000)}_${Math.random().toString(16).slice(2, 6)}`;

    currentSession = {
      participantId,
      gender,
      age,
      isAdminTest,
      firstGroup,
      secondGroup,
      trials,
      currentIndex: 0,
      inBreak: false,
      breakEndTime: null,
      isFinished: false,
      block1Synced: false,
      block2Synced: false
    };

    saveSession(currentSession);

    // Предзагрузка первых 3 картинок блока
    preloadImagesFrom(0, 3);

    showScreen("screen-stimulus");
    renderCurrentTrial();
  } catch (connectionErr) {
    errorBox.textContent = connectionErr.message || "Не удалось подключиться к серверу сохранения данных.";
    errorBox.hidden = false;
  } finally {
    btnStart.disabled = false;
    btnStart.textContent = "Начать исследование";
  }
}

/**
 * Отрисовка текущего стимула (Экран 2)
 */
function renderCurrentTrial() {
  if (!currentSession || currentSession.currentIndex >= 60) {
    finishExperiment();
    return;
  }

  const btnAdminReset = document.getElementById("btn-admin-reset");
  if (btnAdminReset) {
    btnAdminReset.hidden = !currentSession.isAdminTest;
  }

  const idx = currentSession.currentIndex;
  const trialObj = currentSession.trials[idx];

  // Сброс состояния оценок и таймеров для новой картинки
  currentValence = null;
  currentArousal = null;
  rtFirstClickMs = null;
  minTimeElapsed = false;
  isSubmittingBlock = false;
  if (minViewTimerId) {
    clearTimeout(minViewTimerId);
    minViewTimerId = null;
  }

  // Сброс UI кнопок шкал и подписей
  document.querySelectorAll(".scale-btn").forEach((btn) => btn.classList.remove("selected"));
  document.getElementById("valence-selected-label").textContent = "";
  document.getElementById("arousal-selected-label").textContent = "";
  const btnNext = document.getElementById("btn-next");
  btnNext.disabled = true;
  btnNext.textContent = "Далее";

  // Обновление верхней панели прогресса
  const blockNum = idx < 30 ? 1 : 2;
  const picInBlock = (idx % 30) + 1;
  document.getElementById("progress-text").textContent = `Блок ${blockNum} из 2 • Картинка ${picInBlock} из 30`;
  const progressPercent = ((idx + 1) / 60) * 100;
  document.getElementById("progress-fill").style.width = `${progressPercent}%`;

  // Фоновая предзагрузка картинок i + 1 и i + 2
  preloadImagesFrom(idx + 1, 2);

  // Загрузка и отображение текущего стимула
  const imgEl = document.getElementById("stimulus-image");
  const fallbackEl = document.getElementById("image-fallback");
  const fallbackTextEl = document.getElementById("image-fallback-text");

  fallbackEl.hidden = true;
  imgEl.style.display = "block";

  const candidatePaths = getCandidateImagePaths(trialObj);
  let pathIndex = 0;

  imgEl.onload = () => {
    startTrialTimers();
  };

  imgEl.onerror = () => {
    pathIndex += 1;
    if (pathIndex < candidatePaths.length) {
      imgEl.src = candidatePaths[pathIndex];
      return;
    }
    imgEl.style.display = "none";
    fallbackEl.hidden = false;
    fallbackTextEl.textContent = `Изображение: ${trialObj.imageName}`;
    startTrialTimers();
  };

  imgEl.src = candidatePaths[0];
}

/**
 * Запуск засечки времени t_start и 1.5-секундного таймера после отрисовки картинки
 */
function startTrialTimers() {
  tStart = performance.now();
  const minWait = typeof CONFIG.MIN_VIEW_TIME_MS === "number" ? CONFIG.MIN_VIEW_TIME_MS : 1500;

  minViewTimerId = setTimeout(() => {
    minTimeElapsed = true;
    updateNextButtonState();
  }, minWait);
}

/**
 * Обработка выбора балла по шкале Валентности или Возбуждения
 */
function handleScaleSelect(scale, value) {
  if (rtFirstClickMs === null && tStart > 0) {
    rtFirstClickMs = Math.max(0, Math.round(performance.now() - tStart));
  }

  if (scale === "valence") {
    currentValence = value;
    document.getElementById("valence-selected-label").textContent = VALENCE_LABELS[value] || "";
    document.querySelectorAll('#valence-buttons .scale-btn').forEach((btn) => {
      btn.classList.toggle("selected", parseInt(btn.dataset.value, 10) === value);
    });
  } else if (scale === "arousal") {
    currentArousal = value;
    document.getElementById("arousal-selected-label").textContent = AROUSAL_LABELS[value] || "";
    document.querySelectorAll('#arousal-buttons .scale-btn').forEach((btn) => {
      btn.classList.toggle("selected", parseInt(btn.dataset.value, 10) === value);
    });
  }

  updateNextButtonState();
}

/**
 * Проверка условий разблокировки кнопки «Далее» (обе шкалы выбраны + прошло >= 1500 мс)
 */
function updateNextButtonState() {
  const btnNext = document.getElementById("btn-next");
  const bothSelected = currentValence !== null && currentArousal !== null;
  btnNext.disabled = !(bothSelected && minTimeElapsed && !isSubmittingBlock);
}

/**
 * Переход к следующему стимулу по нажатию «Далее».
 * Оценки сохраняются мгновенно в память браузера, а на 30-й и 60-й картинке отправляются
 * единым блоком в Google Таблицу (с автоматическим резервом на почту через Web3Forms при сбое).
 */
async function handleNextTrial() {
  if (currentValence === null || currentArousal === null || !minTimeElapsed || isSubmittingBlock) {
    return;
  }

  const idx = currentSession.currentIndex;
  const trialObj = currentSession.trials[idx];
  const trialNumber = idx + 1;

  let incrementGroup = null;
  if (!currentSession.isAdminTest) {
    if (trialNumber === 30) {
      incrementGroup = currentSession.firstGroup;
    } else if (trialNumber === 60) {
      incrementGroup = currentSession.secondGroup;
    }
  }

  const record = {
    timestamp: new Date().toISOString(),
    participant_id: currentSession.participantId,
    gender: currentSession.gender,
    age: currentSession.age,
    first_group: currentSession.firstGroup === "A" ? "group_1" : "group_2",
    current_group: trialObj.group === "A" ? "group_1" : "group_2",
    trial_number: trialNumber,
    image_name: trialObj.imageName,
    valence: currentValence,
    arousal: currentArousal,
    rt_first_click_ms: rtFirstClickMs !== null ? rtFirstClickMs : 0,
    increment_group: incrementGroup
  };

  // Мгновенно сохраняем ответ в локальное хранилище
  saveRecordToLocalStorage(record);

  // Если завершен Блок 1 (30-я картинка) — отправляем пакет из первых 30 оценок
  if (trialNumber === 30) {
    isSubmittingBlock = true;
    const btnNext = document.getElementById("btn-next");
    btnNext.disabled = true;
    btnNext.textContent = "Сохранение блока 1...";

    await syncBlockRecords(1, 30, incrementGroup);

    currentSession.currentIndex = 30;
    const breakSeconds = isUrlFastMode ? 5 : (CONFIG.BREAK_DURATION_SEC || 60);
    currentSession.inBreak = true;
    currentSession.breakEndTime = Date.now() + breakSeconds * 1000;
    saveSession(currentSession);
    showBreakScreen();
    return;
  }

  // Если завершен Блок 2 (60-я картинка) — отправляем пакет из вторых 30 оценок
  if (trialNumber === 60) {
    isSubmittingBlock = true;
    const btnNext = document.getElementById("btn-next");
    btnNext.disabled = true;
    btnNext.textContent = "Завершение и отправка...";

    await syncBlockRecords(31, 60, incrementGroup);

    currentSession.currentIndex = 60;
    finishExperiment();
    return;
  }

  currentSession.currentIndex += 1;
  saveSession(currentSession);
  renderCurrentTrial();
}

/**
 * Экран 3: Обязательный 1-минутный перерыв с жесткой привязкой к breakEndTime
 */
function showBreakScreen() {
  showScreen("screen-break");

  const btnContinue = document.getElementById("btn-continue");
  const timerEl = document.getElementById("break-timer");
  btnContinue.disabled = true;

  preloadImagesFrom(30, 3);

  if (breakIntervalId) {
    clearInterval(breakIntervalId);
  }

  const updateTimer = () => {
    const remainingMs = (currentSession.breakEndTime || Date.now()) - Date.now();
    if (remainingMs <= 0) {
      clearInterval(breakIntervalId);
      breakIntervalId = null;
      timerEl.textContent = "00:00";
      btnContinue.disabled = false;
      triggerBreakFinishedAlert();
      return;
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  updateTimer();
  breakIntervalId = setInterval(updateTimer, 250);
}

/**
 * Оповещение об окончании перерыва (Web Audio API + мигание вкладки)
 */
function triggerBreakFinishedAlert() {
  playDoubleBeep();

  if (document.hidden) {
    startTabBlinking();
  }
}

/**
 * Продолжение исследования после завершения перерыва
 */
function handleBreakContinue() {
  if (!currentSession) return;
  const remainingMs = (currentSession.breakEndTime || 0) - Date.now();
  if (remainingMs > 0) return;

  stopTabBlinking();
  currentSession.inBreak = false;
  currentSession.breakEndTime = null;
  saveSession(currentSession);

  showScreen("screen-stimulus");
  renderCurrentTrial();
}

/**
 * Завершение эксперимента (после 60-й картинки)
 */
function finishExperiment() {
  if (currentSession) {
    currentSession.isFinished = true;
    saveSession(currentSession);

    if (!currentSession.isAdminTest) {
      localStorage.setItem(STORAGE_KEYS.COMPLETED, "true");
    }
  }
  showFinalScreen();
}

/**
 * Показ финального экрана (Экран 4)
 */
function showFinalScreen() {
  stopTabBlinking();
  showScreen("screen-final");

  const downloadSection = document.getElementById("local-download-section");
  const isLocalMode = !CONFIG.GOOGLE_SCRIPT_URL || CONFIG.GOOGLE_SCRIPT_URL.trim() === "";
  if (downloadSection) {
    downloadSection.hidden = !isLocalMode;
  }
}

/**
 * Фоновая предзагрузка картинок (с учетом подпапок group_1 / group_2 и fallback на .jpg)
 */
function preloadImagesFrom(startIndex, count) {
  if (!currentSession || !currentSession.trials) return;

  for (let i = startIndex; i < startIndex + count && i < currentSession.trials.length; i++) {
    const trialObj = currentSession.trials[i];
    const candidatePaths = getCandidateImagePaths(trialObj);
    let idx = 0;
    const img = new Image();
    img.onerror = () => {
      idx += 1;
      if (idx < candidatePaths.length) {
        img.src = candidatePaths[idx];
      }
    };
    img.src = candidatePaths[0];
  }
}

/**
 * Двойной звуковой сигнал средней комфортной громкости через Web Audio API (587.33 Гц -> 783.99 Гц)
 */
async function playDoubleBeep() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const now = audioCtx.currentTime + 0.02;

    playTone(audioCtx, 587.33, now, 0.25, 0.48);
    playTone(audioCtx, 783.99, now + 0.28, 0.42, 0.52);
  } catch (err) {
    console.warn("Не удалось воспроизвести звуковой сигнал:", err);
  }
}

function playTone(ctx, freq, startTime, duration, maxGain) {
  const oscMain = ctx.createOscillator();
  const oscSub = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscMain.type = "triangle";
  oscMain.frequency.setValueAtTime(freq, startTime);

  oscSub.type = "sine";
  oscSub.frequency.setValueAtTime(freq * 2, startTime);

  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.12, startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(maxGain, startTime + 0.02);
  gainNode.gain.setValueAtTime(maxGain, startTime + duration * 0.45);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscMain.connect(gainNode);
  oscSub.connect(subGain);
  subGain.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscMain.start(startTime);
  oscSub.start(startTime);
  oscMain.stop(startTime + duration + 0.02);
  oscSub.stop(startTime + duration + 0.02);
}

/**
 * Мигание заголовка вкладки и смена favicon по окончании перерыва
 */
function startTabBlinking() {
  if (titleBlinkIntervalId) return;

  let toggle = false;
  const faviconEl = document.getElementById("favicon");

  titleBlinkIntervalId = setInterval(() => {
    if (!document.hidden) {
      stopTabBlinking();
      return;
    }
    toggle = !toggle;
    document.title = toggle ? "🔔 Продолжить исследование!" : "OASIS — Перерыв завершен";
    if (faviconEl) {
      faviconEl.href = toggle ? ALERT_FAVICON : DEFAULT_FAVICON;
    }
  }, 1000);
}

function stopTabBlinking() {
  if (titleBlinkIntervalId) {
    clearInterval(titleBlinkIntervalId);
    titleBlinkIntervalId = null;
  }
  document.title = DEFAULT_TITLE;
  const faviconEl = document.getElementById("favicon");
  if (faviconEl) {
    faviconEl.href = DEFAULT_FAVICON;
  }
}

/**
 * МЯГКАЯ ПРОВЕРКА ПОДКЛЮЧЕНИЯ К GOOGLE ТАБЛИЦЕ ПЕРЕД СТАРТОМ
 * Если Google Таблица доступна — берем точные счетчики из нее.
 * Если у участника стоит AdBlock / прокси, который режет Google Таблицы — НЕ блокируем участника
 * и не требуем Инкогнито, а выбираем группу 50/50 и в конце автоматически отправляем ответы на почту через Web3Forms.
 */
async function getGroupCountersStrict() {
  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();

  if (!scriptUrl) {
    return getLocalCounters();
  }

  const separator = scriptUrl.includes("?") ? "&" : "?";
  const pingUrl = `${scriptUrl}${separator}check=1&t=${Date.now()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500); // Ждем максимум 4.5 сек, чтобы старт был быстрым

  try {
    const response = await fetch(pingUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Код ответа сервера: ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.status !== "ok" || typeof data.countA !== "number" || typeof data.countB !== "number") {
      throw new Error("Некорректный ответ от Google Таблицы");
    }

    return { countA: data.countA, countB: data.countB };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Доступ к Google Таблице ограничен браузером участника. Запускаем тест со случайным выбором первой группы (50/50) и резервной отправкой на почту:", err);
    return { countA: 0, countB: 0 };
  }
}

function getLocalCounters() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_COUNTERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        countA: Number(parsed.countA) || 0,
        countB: Number(parsed.countB) || 0
      };
    }
  } catch (e) {
    console.warn(e);
  }
  return { countA: 0, countB: 0 };
}

function incrementLocalCounter(groupName) {
  const counts = getLocalCounters();
  if (groupName === "A") counts.countA += 1;
  if (groupName === "B") counts.countB += 1;
  localStorage.setItem(STORAGE_KEYS.LOCAL_COUNTERS, JSON.stringify(counts));
}

/**
 * Сохранение одной оценки в localStorage браузера
 */
function saveRecordToLocalStorage(record) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_RESPONSES);
    const list = raw ? JSON.parse(raw) : [];
    const existingIndex = list.findIndex(
      (r) => r.participant_id === record.participant_id && r.trial_number === record.trial_number
    );
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.push(record);
    }
    localStorage.setItem(STORAGE_KEYS.LOCAL_RESPONSES, JSON.stringify(list));
  } catch (err) {
    console.error("Ошибка сохранения ответа в localStorage:", err);
  }

  if (record.increment_group) {
    incrementLocalCounter(record.increment_group);
  }
}

/**
 * Получение записей текущего участника за указанный диапазон (например, 1..30 или 31..60)
 */
function getParticipantRecordsInRange(startTrial, endTrial) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_RESPONSES);
    const list = raw ? JSON.parse(raw) : [];
    return list
      .filter(
        (r) =>
          r.participant_id === currentSession.participantId &&
          r.trial_number >= startTrial &&
          r.trial_number <= endTrial
      )
      .sort((a, b) => a.trial_number - b.trial_number);
  } catch (e) {
    return [];
  }
}

/**
 * Пакетная отправка блока (30 оценок) в Google Таблицу.
 * Если Google Таблица недоступна или заблокирована — автоматически отправляет резервную копию на почту через Web3Forms.
 */
async function syncBlockRecords(startTrial, endTrial, incrementGroup) {
  const records = getParticipantRecordsInRange(startTrial, endTrial);
  if (records.length === 0) return;

  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();
  const blockLabel = endTrial === 30 ? "Блок 1 (1–30)" : "Блок 2 (31–60)";

  if (scriptUrl) {
    try {
      await sendBatchToGoogleSheet(scriptUrl, records, incrementGroup);
      if (endTrial === 30) currentSession.block1Synced = true;
      if (endTrial === 60) currentSession.block2Synced = true;
      saveSession(currentSession);
      return;
    } catch (sheetErr) {
      console.warn(`Не удалось отправить ${blockLabel} в Google Таблицу, включаем резервную отправку на почту:`, sheetErr);
    }
  }

  // Если Google Таблица не приняла блок — отправляем резервное письмо через Web3Forms
  // (В финале после 60-й картинки отправляем сразу все 60 строк участника одним письмом, если Блок 1 тоже не дошел в таблицу)
  const isFull60Fallback = endTrial === 60 && !currentSession.block1Synced;
  const recordsForEmail = isFull60Fallback
    ? getParticipantRecordsInRange(1, 60)
    : records;
  const emailLabel = isFull60Fallback ? "ПОЛНЫЕ 60 СТРОК (Блок 1 + Блок 2)" : blockLabel;

  await sendBackupEmailViaWeb3Forms(recordsForEmail, emailLabel);
}

/**
 * Отправка пакета записей в Google Таблицу (с поддержкой как нового пакетного скрипта, так и построчного)
 */
async function sendBatchToGoogleSheet(scriptUrl, records, incrementGroup) {
  const payload = {
    participant_id: currentSession.participantId,
    increment_group: incrementGroup,
    records: records
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(scriptUrl, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const resData = await response.json();
    if (!resData || resData.status !== "ok") {
      throw new Error("Ответ сервера Google Таблиц не содержит status: ok");
    }

    // Если в Google Таблице еще стоит старая версия gas_backend.js (без поддержки массива records),
    // она запишет только 1 строку (resData.written не будет равен records.length) — тогда дошлем остальные построчно:
    if (typeof resData.written !== "number" && records.length > 1) {
      for (const rec of records) {
        await fetch(scriptUrl, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(rec)
        });
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * АВАРИЙНАЯ ОТПРАВКА ДАННЫХ НА ПОЧТУ ИССЛЕДОВАТЕЛЯ ЧЕРЕЗ WEB3FORMS
 * Не требует от испытуемого никаких действий и не собирает его личные данные.
 */
async function sendBackupEmailViaWeb3Forms(records, blockLabel) {
  const accessKey = (CONFIG.WEB3FORMS_ACCESS_KEY || "").trim();
  if (!accessKey || !records || records.length === 0) return false;

  const headers = [
    "timestamp",
    "participant_id",
    "gender",
    "age",
    "first_group",
    "current_group",
    "trial_number",
    "image_name",
    "valence",
    "arousal",
    "rt_first_click_ms"
  ];

  // Формат с разделителем ТАБУЛЯЦИЯ (TSV) — можно просто скопировать из письма и нажать Ctrl+V в ячейку A Google Таблицы!
  const tsvLines = [
    headers.join("\t"),
    ...records.map((r) => headers.map((h) => (r[h] !== undefined && r[h] !== null ? String(r[h]) : "")).join("\t"))
  ];

  // Классический CSV-формат через запятую
  const csvLines = [
    headers.join(","),
    ...records.map((r) => headers.map((h) => (r[h] !== undefined && r[h] !== null ? String(r[h]) : "")).join(","))
  ];

  const participantId = currentSession ? currentSession.participantId : "Unknown";
  const gender = currentSession ? currentSession.gender : "";
  const age = currentSession ? currentSession.age : "";

  const messageBody =
    `Автоматическая резервная выгрузка данных исследования OASIS.\n` +
    `Участник: ${participantId} (${gender}, возраст: ${age})\n` +
    `Блок: ${blockLabel} (количество строк: ${records.length})\n\n` +
    `=== ВАРИАНТ 1: ДЛЯ ПРЯМОЙ ВСТАВКИ В GOOGLE ТАБЛИЦУ (ТАБУЛЯЦИЯ) ===\n` +
    `(Скопируйте строки ниже без заголовка и нажмите Ctrl+V в первую свободную ячейку столбца A на листе Responses)\n\n` +
    tsvLines.join("\n") +
    `\n\n=== ВАРИАНТ 2: СТАНДАРТНЫЙ CSV (ЧЕРЕЗ ЗАПЯТУЮ) ===\n\n` +
    csvLines.join("\n");

  try {
    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        access_key: accessKey,
        subject: `OASIS Резервная копия: ${participantId} — ${blockLabel} (${records.length} строк)`,
        from_name: "OASIS Study Backup",
        message: messageBody
      })
    });

    return response.ok;
  } catch (err) {
    console.warn("Ошибка резервной отправки через Web3Forms:", err);
    return false;
  }
}

/**
 * Скачивание накопленных результатов в формате CSV (UTF-8 с BOM для Excel)
 */
function downloadLocalCsv() {
  const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_RESPONSES);
  const rows = raw ? JSON.parse(raw) : [];

  const headers = [
    "timestamp",
    "participant_id",
    "gender",
    "age",
    "first_group",
    "current_group",
    "trial_number",
    "image_name",
    "valence",
    "arousal",
    "rt_first_click_ms"
  ];

  const escapeCsvCell = (val) => {
    const str = val === null || val === undefined ? "" : String(val);
    if (/[",;\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(","))
  ];

  const csvContent = "\uFEFF" + csvLines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  link.download = `oasis_results_${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Алгоритм перемешивания Фишера — Йетса
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Работа с сессией в localStorage
 */
function saveSession(sessionObj) {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sessionObj));
  } catch (e) {
    console.error("Не удалось сохранить сессию:", e);
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Переключение видимого экрана
 */
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === screenId);
  });
  window.scrollTo(0, 0);
}
