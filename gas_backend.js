/**
 * Код для Google Apps Script (файл gas_backend.js)
 * 
 * Инструкция по установке:
 * 1. Создайте новую Google Таблицу.
 * 2. В верхнем меню выберите «Расширения» -> «Apps Script».
 * 3. Удалите весь текст, который там есть, и вставьте этот код целиком.
 * 4. Нажмите иконку дискеты «Сохранить проект» (Ctrl + S).
 * 5. В правом верхнем углу нажмите синюю кнопку «Начать развертывание» -> «Новое развертывание».
 * 6. Нажмите на шестеренку слева («Выбрать тип») -> выберите «Веб-приложение».
 * 7. В поле «У кого есть доступ» обязательно выберите «Все» (Anyone).
 * 8. Нажмите «Начать развертывание», выдайте разрешение своему аккаунту и скопируйте полученный URL веб-приложения.
 * 9. Вставьте этот URL в файл config.js в поле GOOGLE_SCRIPT_URL.
 */

const SHEET_RESPONSES = "Responses";
const SHEET_COUNTERS = "Counters";

/**
 * Автоматически создает листы Responses и Counters с заголовками при первом обращении,
 * если вы еще не создали их вручную.
 */
function ensureSheetsSetup(ss) {
  let respSheet = ss.getSheetByName(SHEET_RESPONSES);
  if (!respSheet) {
    respSheet = ss.insertSheet(SHEET_RESPONSES);
  }
  if (respSheet.getLastRow() === 0) {
    respSheet.appendRow([
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
    ]);
  }

  let countSheet = ss.getSheetByName(SHEET_COUNTERS);
  if (!countSheet) {
    countSheet = ss.insertSheet(SHEET_COUNTERS);
  }
  if (countSheet.getLastRow() === 0) {
    countSheet.getRange("A1:B2").setValues([
      ["group_1_completed", 0],
      ["group_2_completed", 0]
    ]);
  }

  return { respSheet, countSheet };
}

/**
 * GET-запрос: возвращает количество полных прохождений Группы 1 (countA) и Группы 2 (countB)
 */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { countSheet } = ensureSheetsSetup(ss);

  const values = countSheet.getRange("A1:B2").getValues();
  const countA = Number(values[0][1]) || 0;
  const countB = Number(values[1][1]) || 0;

  const result = {
    status: "ok",
    countA: countA,
    countB: countB
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST-запрос: записывает оценку одной картинки в лист Responses
 * и атомарно увеличивает счетчик в листе Counters (через LockService), когда блок из 30 картинок завершен
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const { respSheet, countSheet } = ensureSheetsSetup(ss);

    const data = JSON.parse(e.postData.contents);

    respSheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.participant_id || "",
      data.gender || "",
      data.age || "",
      data.first_group || "",
      data.current_group || "",
      data.trial_number || "",
      data.image_name || "",
      data.valence || "",
      data.arousal || "",
      data.rt_first_click_ms !== undefined ? data.rt_first_click_ms : ""
    ]);

    // Атомарный инкремент счетчика завершенных групп (для "Тест_админа" не увеличивается)
    if (data.increment_group && data.participant_id !== "Тест_админа") {
      if (data.increment_group === "A" || data.increment_group === "group_1") {
        const cell = countSheet.getRange("B1");
        cell.setValue((Number(cell.getValue()) || 0) + 1);
      } else if (data.increment_group === "B" || data.increment_group === "group_2") {
        const cell = countSheet.getRange("B2");
        cell.setValue((Number(cell.getValue()) || 0) + 1);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
