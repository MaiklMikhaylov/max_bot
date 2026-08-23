import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { CLASS_PREFIX, VIOLATION_FORMS, getReason, type ViolationFormId } from './catalog.js';
import { config } from './config.js';
import {
  absentsInClass,
  countStudentsByClass,
  formatDateRu,
  getStudent,
  markedClasses,
  todayIso,
} from './storage.js';

export interface AbsentStats {
  allStudents: number;
  allInLyceum: number;
  byClass: Record<number, {
    studentsInClass: number;
    absentStudents: number;
    absentIn: number;
    absentOut: number;
    absentsNameReason: string[];
  }>;
}

export async function handleAbsentData(date = todayIso()): Promise<AbsentStats> {
  const data: AbsentStats = { allStudents: 0, allInLyceum: 0, byClass: {} };
  const classes = await markedClasses(date);

  for (const classRecord of classes) {
    const studentsInClass = await countStudentsByClass(classRecord.classId);
    const classData = {
      studentsInClass,
      absentStudents: 0,
      absentIn: 0,
      absentOut: 0,
      absentsNameReason: [] as string[],
    };
    data.byClass[classRecord.classId] = classData;
    data.allInLyceum += studentsInClass;
    data.allStudents += studentsInClass;

    for (const absent of await absentsInClass(classRecord.classId, date)) {
      classData.absentStudents += 1;
      const student = await getStudent(absent.studentId);
      const reason = getReason(absent.reasonId);
      classData.absentsNameReason.push(
        `${student?.surname ?? ''} ${student?.name ?? ''} (${reason?.title ?? ''})`.trim(),
      );
      if (reason?.inLyceum) classData.absentIn += 1;
      else {
        classData.absentOut += 1;
        data.allInLyceum -= 1;
      }
    }
  }

  return data;
}

export async function createAbsenceReport(date = todayIso()): Promise<string | undefined> {
  await mkdir(config.outputDir, { recursive: true });
  const dateRu = formatDateRu(date);
  const outputPath = path.join(config.outputDir, `${dateRu}.docx`);

  try {
    const content = await readFile(config.reportTemplateFile);
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      parser: (tag) => {
        const key = tag.trim();
        return {
          get: (scope: Record<string, string | number>) => scope[key] ?? '',
        };
      },
    });
    const stats = await handleAbsentData(date);
    const context: Record<string, string | number> = {
      date: dateRu,
      all_in_lyceum: stats.allInLyceum,
      all_students: stats.allStudents,
    };

    for (const prefix of Object.values(CLASS_PREFIX)) {
      context[prefix] = '';
      context[`${prefix}_in`] = '';
      context[`${prefix}_out`] = '';
      context[`${prefix}_all`] = '';
      context[`${prefix}_absent`] = '';
    }

    for (const classRecord of await markedClasses(date)) {
      const prefix = CLASS_PREFIX[classRecord.className];
      if (!prefix) continue;
      const classData = stats.byClass[classRecord.classId];
      context[prefix] = classData.studentsInClass - classData.absentStudents;
      context[`${prefix}_in`] = classData.absentIn;
      context[`${prefix}_out`] = classData.absentOut;
      context[`${prefix}_all`] = classData.studentsInClass;
      context[`${prefix}_absent`] = classData.absentsNameReason.join(', ');
    }

    doc.render(context);
    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    await writeFile(outputPath, buffer);
    console.log(`Absence report saved: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Failed to create absence report:', error);
    return undefined;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Фамилия + инициалы: «Иванов Максим Игоревич» → { surname: 'Иванов', initials: 'М.И.' } */
export function formatAuthorShort(fullName: string): { surname: string; initials: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { surname: '', initials: '' };
  const surname = parts[0];
  const initials = parts
    .slice(1)
    .map((part) => {
      const ch = part[0];
      return ch ? `${ch.toUpperCase()}.` : '';
    })
    .join('');
  return { surname, initials };
}

function replaceLastWt(xml: string, text: string, replacement: string): string {
  const re = new RegExp(`<w:t(?:\\s[^>]*)?>${escapeRegex(text)}</w:t>`, 'g');
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) last = match;
  if (!last) return xml;
  return (
    xml.slice(0, last.index) +
    `<w:t>${escapeXml(replacement)}</w:t>` +
    xml.slice(last.index + last[0].length)
  );
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function timesParagraph(
  text: string,
  options?: { bold?: boolean; align?: 'both' | 'right' | 'center'; spaceAfter?: boolean },
): string {
  const align = options?.align ?? 'both';
  const bold = options?.bold ? '<w:b/><w:bCs/>' : '';
  const after = options?.spaceAfter === false ? '0' : '120';
  const safe = escapeXml(text);
  return (
    `<w:p>` +
    `<w:pPr><w:spacing w:after="${after}"/><w:jc w:val="${align}"/>` +
    `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `${bold}<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
    `${bold}<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` +
    `<w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`
  );
}

export interface ViolationReportInput {
  studentFullName: string;
  className: string;
  formId: ViolationFormId;
  description: string;
  authorFullName: string;
  date?: string;
}

export async function createViolationReport(input: ViolationReportInput): Promise<string | undefined> {
  await mkdir(config.violationOutputDir, { recursive: true });
  const dateRu = formatDateRu(input.date ?? todayIso());
  const formTitle = VIOLATION_FORMS.find((item) => item.formId === input.formId)?.title ?? input.formId;
  const { surname, initials } = formatAuthorShort(input.authorFullName);
  const safeName = input.studentFullName.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  const outputPath = path.join(
    config.violationOutputDir,
    `${dateRu}_${input.className}_${safeName}.docx`,
  );

  try {
    const content = await readFile(config.violationTemplateFile);
    const zip = new PizZip(content);
    const file = zip.file('word/document.xml');
    if (!file) throw new Error('word/document.xml missing in template');
    let xml = file.asText();

    // Подставить ФИО составителя вместо подчёркивания после «от»
    const author = escapeXml(input.authorFullName);
    xml = xml
      .replace(/от _{2,}/g, `от ${author}`)
      .replace(/от _+/g, `от ${author}`)
      .replace(/от ______/g, `от ${author}`);

    const bodyLines = [
      timesParagraph(''),
      timesParagraph(
        `Ученик(ца) ${input.studentFullName}, обучающийся(аяся) в ${input.className} классе, ` +
          `совершил(а) нарушение по форме «${formTitle}».`,
      ),
      timesParagraph(''),
      timesParagraph(`Описание нарушения: ${input.description}`),
      timesParagraph(''),
    ].join('');

    const dokladMatch = xml.match(/Докладная<\/w:t><\/w:r><\/w:p>/);
    if (dokladMatch?.index !== undefined) {
      const insertAt = dokladMatch.index + dokladMatch[0].length;
      xml = `${xml.slice(0, insertAt)}${bodyLines}${xml.slice(insertAt)}`;
    } else {
      const marker = '<w:sectPr';
      const idx = xml.lastIndexOf(marker);
      if (idx === -1) throw new Error('sectPr not found in template');
      xml = `${xml.slice(0, idx)}${bodyLines}${xml.slice(idx)}`;
    }

    xml = xml.replace(
      /(<w:t(?:\s[^>]*)?>)_{10,}(<\/w:t>)/,
      `$1${escapeXml(dateRu)}$2`,
    );
    if (initials) xml = replaceLastWt(xml, 'А.А.', initials);
    if (surname) xml = replaceLastWt(xml, 'Костанян', surname);

    zip.file('word/document.xml', xml);
    const buffer = zip.generate({ type: 'nodebuffer' });
    await writeFile(outputPath, buffer);
    console.log(`Violation report saved: ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error('Failed to create violation report:', error);
    return undefined;
  }
}
