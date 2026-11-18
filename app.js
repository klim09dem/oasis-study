/**
 * Логика веб-приложения для нормирования стимулов по протоколу OASIS (Kurdi et al., 2017)
 * Версия с обязательной проверкой связи с Google Таблицами перед стартом и защитой от потери ответов
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
  PENDING_QUEUE: "oasis_pending_queue_v4"
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
let isSubmittingTrial = false;

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

  // Если есть неотправленные записи в очереди, пробуем дослать их в фоне
  flushPendingQueue();

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
    // Перед продолжением старой сессии проверяем, что доступ к Google Таблице не заблокирован
    const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();
    if (scriptUrl) {
      try {
        await getGroupCountersStrict();
      } catch (err) {
        showScreen("screen-intro");
        const errorBox = document.getElementById("form-error");
        if (errorBox) {
          errorBox.textContent = err.message;
          errorBox.hidden = false;
        }
        return;
      }
    }
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
    // 1. Строгая проверка подключения к Google Таблице и чтение счетчиков групп.
    // Если скрипт заблокирован AdBlock / uBlock / Brave / антивирусом или нет сети — выбрасывается ошибка, и тест НЕ начинается.
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
      isFinished: false
    };

    saveSession(currentSession);

    // Предзагрузка первых 3 картинок блока
    preloadImagesFrom(0, 3);

    showScreen("screen-stimulus");
    renderCurrentTrial();
  } catch (connectionErr) {
    // Выводим понятное сообщение об ошибке прямо над кнопкой «Начать исследование» и НЕ запускаем тест
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
  isSubmittingTrial = false;
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

  // Загрузка и отображение текущего стимула (из папки images/group_1 или images/group_2)
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
  btnNext.disabled = !(bothSelected && minTimeElapsed && !isSubmittingTrial);
}

/**
 * Переход к следующему стимулу по нажатию «Далее»
 * На 1-й картинке дополнительно дожидается успешной отправки POST-запроса в Google Таблицу.
 */
async function handleNextTrial() {
  if (currentValence === null || currentArousal === null || !minTimeElapsed || isSubmittingTrial) {
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

  // На первой картинке (trialNumber === 1) обязательно проверяем, что POST-запрос на запись проходит и не блокируется
  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();
  if (scriptUrl && trialNumber === 1) {
    isSubmittingTrial = true;
    const btnNext = document.getElementById("btn-next");
    btnNext.disabled = true;
    btnNext.textContent = "Сохранение...";

    const sentOk = await saveTrialResponse(record, true);
    if (!sentOk) {
      isSubmittingTrial = false;
      btnNext.disabled = false;
      btnNext.textContent = "Далее";
      alert(
        "Не удалось отправить оценку в Google Таблицу (запрос заблокирован браузером или прервалось соединение).\n\n" +
        "Пожалуйста, отключите блокировщик рекламы (AdBlock, uBlock Origin, AdGuard, щит Brave) или проверьте интернет и нажмите «Далее» еще раз."
      );
      return;
    }
  } else {
    // Для остальных картинок отправляем асинхронно с автоматической очередью досылки при сбоях сети
    saveTrialResponse(record, false);
  }

  currentSession.currentIndex += 1;

  if (currentSession.currentIndex === 30) {
    const breakSeconds = isUrlFastMode ? 5 : (CONFIG.BREAK_DURATION_SEC || 60);
    currentSession.inBreak = true;
    currentSession.breakEndTime = Date.now() + breakSeconds * 1000;
    saveSession(currentSession);
    showBreakScreen();
    return;
  }

  if (currentSession.currentIndex >= 60) {
    finishExperiment();
    return;
  }

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
  flushPendingQueue();

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
  flushPendingQueue();

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
 * СТРОГАЯ ПРОВЕРКА ПОДКЛЮЧЕНИЯ К GOOGLE ТАБЛИЦЕ ПЕРЕД СТАРТОМ
 * Больше не переключается молча на локальный режим, если запрос заблокирован!
 */
async function getGroupCountersStrict() {
  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();

  // Если URL в config.js специально оставлен пустым (автономная отладка на ПК без интернета)
  if (!scriptUrl) {
    return getLocalCounters();
  }

  const separator = scriptUrl.includes("?") ? "&" : "?";
  const pingUrl = `${scriptUrl}${separator}check=1&t=${Date.now()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд максимум

  try {
    const response = await fetch(pingUrl, {
      method: "GET",
      cache: "no-store",
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
    console.error("Ошибка проверки связи с Google Таблицей:", err);
    throw new Error(
      "Не удалось подключиться к серверу сохранения данных (доступ к Google Таблицам заблокирован вашим браузером или сетью). " +
      "Пожалуйста, отключите блокировщик рекламы (AdBlock, uBlock Origin, AdGuard, встроенный щит в браузере Brave) или смените браузер, обновите страницу и нажмите «Начать исследование» снова."
    );
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
 * Сохранение ответа по одной картинке + очередь гарантированной доставки при кратковременных сбоях сети
 */
async function saveTrialResponse(record, waitForConfirmation = false) {
  // 1. Всегда сохраняем резервную копию в localStorage браузера
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_RESPONSES);
    const list = raw ? JSON.parse(raw) : [];
    const alreadySaved = list.some(
      (r) => r.participant_id === record.participant_id && r.trial_number === record.trial_number
    );
    if (!alreadySaved) {
      list.push(record);
      localStorage.setItem(STORAGE_KEYS.LOCAL_RESPONSES, JSON.stringify(list));
    }
  } catch (err) {
    console.error("Ошибка сохранения ответа в localStorage:", err);
  }

  if (record.increment_group) {
    incrementLocalCounter(record.increment_group);
  }

  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();
  if (!scriptUrl) {
    return true;
  }

  // 2. Отправляем POST-запрос в Google Таблицу
  try {
    await sendPostToGoogleSheet(scriptUrl, record);
    // Если отправка прошла успешно, заодно пробуем протолкнуть возможные старые записи из очереди
    flushPendingQueue();
    return true;
  } catch (err) {
    console.warn("Ошибка отправки ответа в Google Таблицу:", err);
    if (!waitForConfirmation) {
      enqueuePendingRecord(record);
    }
    return false;
  }
}

async function sendPostToGoogleSheet(scriptUrl, record) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    await fetch(scriptUrl, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      signal: controller.signal,
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(record)
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Очередь неотправленных записей (на случай секундного обрыва Wi-Fi в середине теста)
 */
function enqueuePendingRecord(record) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PENDING_QUEUE);
    const queue = raw ? JSON.parse(raw) : [];
    const exists = queue.some(
      (r) => r.participant_id === record.participant_id && r.trial_number === record.trial_number
    );
    if (!exists) {
      queue.push(record);
      localStorage.setItem(STORAGE_KEYS.PENDING_QUEUE, JSON.stringify(queue));
    }
  } catch (e) {
    console.warn(e);
  }
}

async function flushPendingQueue() {
  const scriptUrl = (CONFIG.GOOGLE_SCRIPT_URL || "").trim();
  if (!scriptUrl) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PENDING_QUEUE);
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      try {
        await sendPostToGoogleSheet(scriptUrl, item);
      } catch (err) {
        remaining.push(item);
      }
    }
    localStorage.setItem(STORAGE_KEYS.PENDING_QUEUE, JSON.stringify(remaining));
  } catch (e) {
    console.warn(e);
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
