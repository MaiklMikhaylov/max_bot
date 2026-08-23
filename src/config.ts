import 'dotenv/config';
import path from 'node:path';

function parseAdminIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isFinite(id));
}

export const config = {
  botToken: process.env.BOT_TOKEN ?? '',
  adminIds: parseAdminIds(process.env.ADMIN_IDS),
  tasksChatTitle: process.env.TASKS_CHAT_TITLE ?? 'Лицей Иннополис. Заявки',
  studentsInfoChatTitle: process.env.STUDENTS_INFO_CHAT_TITLE ?? 'Информация по детям',
  dataDir: process.env.DATA_DIR ?? 'data',
  inputDir: path.resolve('input'),
  outputDir: path.resolve('output', 'absence_reports'),
  imagesDir: path.resolve('images'),
  studentDataFile: path.resolve('input', process.env.STUDENT_DATA_FILENAME ?? 'inputclass.xlsx'),
  reportTemplateFile: path.resolve(
    'input',
    process.env.ABSENT_REPORT_TEMPLATE_FILENAME ?? 'absence_report_template.docx',
  ),
  violationTemplateFile: path.resolve(
    process.env.VIOLATION_TEMPLATE_FILENAME ?? 'shablon.docx',
  ),
  violationOutputDir: path.resolve('output', 'violation_reports'),
  /** Временно: Word-отчёт по отсутствующим дублировать в чат заявок */
  absenceReportToTasksChat: process.env.ABSENCE_REPORT_TO_TASKS_CHAT !== '0',
  /** Получатели докладных (помимо админов) */
  violationDisciplineRecipients: (
    process.env.VIOLATION_DISCIPLINE_RECIPIENTS ?? 'Пепуль Анна Олеговна'
  )
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean),
  violationStudyRecipients: (
    process.env.VIOLATION_STUDY_RECIPIENTS ?? 'Дейнекина Светлана Вячеславовна'
  )
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean),
  miniappPort: Number(process.env.MINIAPP_PORT ?? '8080'),
  miniappDir: path.resolve(process.env.MINIAPP_DIR ?? 'miniapp'),
  /** Подсказка для настройки URL мини-приложения в кабинете MAX */
  miniappPublicUrl: process.env.MINIAPP_PUBLIC_URL ?? '',
};

if (!config.botToken) {
  throw new Error('BOT_TOKEN is not set in environment variables');
}
