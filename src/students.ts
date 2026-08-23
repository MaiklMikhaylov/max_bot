import ExcelJS from 'exceljs';
import { VALID_CLASSES } from './catalog.js';
import { config } from './config.js';
import { addClass, replaceStudents } from './storage.js';

export async function loadStudentsFromExcel(): Promise<boolean> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(config.studentDataFile);
  } catch (error) {
    console.error('Failed to read students file:', error);
    return false;
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return false;

  const prepared: Array<{ surname: string; name: string; middlename?: string | null; classId: number }> = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const fullname = String(row.getCell(1).value ?? '').trim();
    const className = String(row.getCell(2).value ?? '').trim();
    if (!fullname && !className) continue;
    if (!fullname || !className) {
      console.warn(`Row ${rowNumber} skipped: empty values`);
      continue;
    }

    const parts = fullname.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) {
      console.warn(`Row ${rowNumber} skipped: invalid FIO "${fullname}"`);
      continue;
    }
    if (!VALID_CLASSES.includes(className as (typeof VALID_CLASSES)[number])) {
      console.warn(`Row ${rowNumber} skipped: invalid class "${className}"`);
      continue;
    }

    const classId = await addClass(className);
    prepared.push({
      surname: parts[0],
      name: parts[1],
      middlename: parts[2] ?? null,
      classId,
    });
  }

  await replaceStudents(prepared);
  console.log(`Loaded ${prepared.length} students`);
  return true;
}
