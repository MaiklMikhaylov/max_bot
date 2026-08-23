import { Keyboard } from '@maxhub/max-bot-api';
import {
  ABSENCE_REASONS,
  BUILDING_BLOCKS,
  ROLES,
  TECHNICIAN_ROLES,
  VIOLATION_FORMS,
  getRole,
} from './catalog.js';
import { classifyRoles, type ClassRecord, type Employee, type Student, type TaskRecord } from './storage.js';

export const MENU_TEXT = {
  start: 'Старт',
  register: 'Регистрация',
  admin: '⚙️ Администрирование',
  absents: '🖍 Отметить отсутствующих',
  violations: '⚠️ Правонарушение',
  tasks: '📌 Задачи',
  repair: '🔧 Заявка на ремонт',
  main: 'Главное меню',
} as const;

export const START_CALLBACK = 'go:start';

/** Inline «Старт» → меню /start */
export function startButton() {
  return Keyboard.button.callback(MENU_TEXT.start, START_CALLBACK);
}

export function startOnlyKeyboard() {
  return Keyboard.inlineKeyboard([[startButton()]]);
}

type InlineKeyboard = {
  type: 'inline_keyboard';
  payload: { buttons: Array<Array<{ type: string; payload?: string; text?: string }>> };
};

function isInlineKeyboard(item: unknown): item is InlineKeyboard {
  return Boolean(item && typeof item === 'object' && (item as { type?: string }).type === 'inline_keyboard');
}

function isStartCallbackButton(btn: { type: string; payload?: string }) {
  return btn.type === 'callback' && btn.payload === START_CALLBACK;
}

/**
 * Гарантирует кнопку «Старт» на сообщении: последняя строка клавиатуры.
 * Если клавиатуры нет — добавляет отдельную только со «Старт».
 * (open_app без мини-приложения использовать нельзя — оно только открывает WebApp.)
 */
export function withPersistentStart(attachments?: unknown[]): unknown[] {
  const list = Array.isArray(attachments) ? [...attachments] : [];
  const idx = list.findIndex(isInlineKeyboard);

  if (idx === -1) {
    list.push(startOnlyKeyboard());
    return list;
  }

  const kb = list[idx] as InlineKeyboard;
  const rows = (kb.payload.buttons ?? [])
    .map((row) => row.filter((btn) => !isStartCallbackButton(btn)))
    .filter((row) => row.length > 0);
  rows.push([startButton()]);
  list[idx] = Keyboard.inlineKeyboard(rows as never);
  return list;
}

type ReplyButton = { type: 'message'; text: string };

function replyButton(text: string): ReplyButton {
  return { type: 'message', text };
}

function replyKeyboard(buttons: ReplyButton[][]) {
  return {
    type: 'reply_keyboard',
    buttons,
  };
}

function chunkButtons(items: ReplyButton[], size = 2): ReplyButton[][] {
  const rows: ReplyButton[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export function replyGuestKeyboard() {
  return replyKeyboard([
    [replyButton(MENU_TEXT.start)],
    [replyButton(MENU_TEXT.register)],
  ]);
}

export function replyMenuKeyboard(roleIds: number[]) {
  const { isAdmin, canMarkAbsents, canMarkViolations, isTechnician } = classifyRoles(roleIds);
  const rows: ReplyButton[][] = [[replyButton(MENU_TEXT.start)]];
  const actions: ReplyButton[] = [];
  if (isAdmin) actions.push(replyButton(MENU_TEXT.admin));
  if (canMarkAbsents) actions.push(replyButton(MENU_TEXT.absents));
  if (canMarkViolations) actions.push(replyButton(MENU_TEXT.violations));
  if (isTechnician) actions.push(replyButton(MENU_TEXT.tasks));
  actions.push(replyButton(MENU_TEXT.repair));
  rows.push(...chunkButtons(actions));
  return replyKeyboard(rows);
}

export function mainMenuKeyboard(roleIds: number[]) {
  const { isAdmin, canMarkAbsents, canMarkViolations, isTechnician } = classifyRoles(roleIds);
  const rows = [];
  if (isAdmin) rows.push([Keyboard.button.callback('⚙️ Администрирование', 'menu:admin')]);
  if (canMarkAbsents) rows.push([Keyboard.button.callback('🖍 Отметить отсутствующих', 'menu:absents')]);
  if (canMarkViolations) rows.push([Keyboard.button.callback('⚠️ Правонарушение', 'menu:violations')]);
  if (isTechnician) rows.push([Keyboard.button.callback('📌 Задачи', 'menu:tasks')]);
  rows.push([Keyboard.button.callback('🔧 Заявка на ремонт', 'menu:repair')]);
  // «Старт» добавит withPersistentStart последней строкой
  return Keyboard.inlineKeyboard(rows);
}

export function adminMenuKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('📃 Сотрудники', 'admin:employees'),
      Keyboard.button.callback('📓 Черный список', 'admin:blacklist'),
    ],
    [Keyboard.button.callback('📥 Загрузить учеников', 'admin:load_students')],
    [Keyboard.button.callback('🖍 Отметить отсутствующих', 'menu:absents')],
    [Keyboard.button.callback('⚠️ Правонарушение', 'menu:violations')],
    [Keyboard.button.callback('Главное меню', 'menu:main')],
  ]);
}

export function registrationMarkup() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback('👤 Регистрация', 'reg:start')]]);
}

export function rolesMarkup(chosen: number[]) {
  const rows = ROLES.map((role) => [
    Keyboard.button.callback(
      chosen.includes(role.roleId) ? `✔️ ${role.title}` : role.title,
      `reg:role:${role.roleId}`,
    ),
  ]);
  if (chosen.length >= 1) {
    rows.push([Keyboard.button.callback('✅ Готово', 'reg:done', { intent: 'positive' })]);
  }
  return Keyboard.inlineKeyboard(rows);
}

export function registrationRequestMarkup(requestId: number) {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✅ Принять', `reg:accept:${requestId}`, { intent: 'positive' })],
    [Keyboard.button.callback('⛔️ Отклонить', `reg:reject:${requestId}`, { intent: 'negative' })],
  ]);
}

export function confirmBlockingMarkup(requestId: number) {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('Да', `reg:block:${requestId}`, { intent: 'negative' }),
      Keyboard.button.callback('Нет', `reg:noblock:${requestId}`),
    ],
  ]);
}

export function classesMarkup(classes: ClassRecord[]) {
  const sorted = [...classes].sort((a, b) => {
    const numA = Number.parseInt(a.className, 10);
    const numB = Number.parseInt(b.className, 10);
    return numA - numB || a.className.localeCompare(b.className, 'ru');
  });
  const rows = [];
  for (let i = 0; i < sorted.length; i += 5) {
    rows.push(
      sorted.slice(i, i + 5).map((item) => Keyboard.button.callback(item.className, `abs:class:${item.classId}`)),
    );
  }
  rows.push([Keyboard.button.callback('❌ Отмена', 'abs:cancel')]);
  return Keyboard.inlineKeyboard(rows);
}

export function studentsMarkup(students: Student[], absents: Array<{ studentId: number }>) {
  const absentIds = new Set(absents.map((item) => item.studentId));
  const rows = students.map((student) => [
    Keyboard.button.callback(
      `${absentIds.has(student.studentId) ? '⭕️' : '⚪️'} ${student.surname} ${student.name}`,
      `abs:st:${student.studentId}`,
    ),
  ]);
  rows.push([
    Keyboard.button.callback('⬅ К классам', 'abs:classes'),
    Keyboard.button.callback('❌ Отмена', 'abs:cancel'),
    Keyboard.button.callback('✅ Готово', 'abs:done', { intent: 'positive' }),
  ]);
  return Keyboard.inlineKeyboard(rows);
}

export function reasonsMarkup() {
  const rows = ABSENCE_REASONS.map((reason) => [
    Keyboard.button.callback(reason.title, `abs:reason:${reason.reasonId}`),
  ]);
  rows.push([
    Keyboard.button.callback('⬅ К ученикам', 'abs:students'),
    Keyboard.button.callback('❌ Отмена', 'abs:cancel'),
  ]);
  return Keyboard.inlineKeyboard(rows);
}

export function violationClassesMarkup(classes: ClassRecord[]) {
  const sorted = [...classes].sort((a, b) => {
    const numA = Number.parseInt(a.className, 10);
    const numB = Number.parseInt(b.className, 10);
    return numA - numB || a.className.localeCompare(b.className, 'ru');
  });
  const rows = [];
  for (let i = 0; i < sorted.length; i += 5) {
    rows.push(
      sorted.slice(i, i + 5).map((item) => Keyboard.button.callback(item.className, `viol:class:${item.classId}`)),
    );
  }
  rows.push([Keyboard.button.callback('❌ Отмена', 'viol:cancel')]);
  return Keyboard.inlineKeyboard(rows);
}

export function violationStudentsMarkup(students: Student[]) {
  const rows = students.map((student) => [
    Keyboard.button.callback(
      `${student.surname} ${student.name}`,
      `viol:st:${student.studentId}`,
    ),
  ]);
  rows.push([
    Keyboard.button.callback('⬅ К классам', 'viol:classes'),
    Keyboard.button.callback('❌ Отмена', 'viol:cancel'),
  ]);
  return Keyboard.inlineKeyboard(rows);
}

export function violationFormsMarkup() {
  return Keyboard.inlineKeyboard([
    VIOLATION_FORMS.map((form) => Keyboard.button.callback(form.title, `viol:form:${form.formId}`)),
    [
      Keyboard.button.callback('⬅ К ученикам', 'viol:students'),
      Keyboard.button.callback('❌ Отмена', 'viol:cancel'),
    ],
  ]);
}

export function createViolationMarkup(draft: {
  classId?: number;
  studentId?: number;
  formId?: string;
  description?: string;
  photoToken?: string;
}) {
  const rows = [
    [
      Keyboard.button.callback(draft.classId ? 'Изменить класс' : '🔸 Выбрать класс', 'viol:classes'),
      Keyboard.button.callback(draft.studentId ? 'Изменить ученика' : '🔸 Выбрать ученика', 'viol:students'),
    ],
    [
      Keyboard.button.callback(
        draft.formId ? 'Изменить форму нарушения' : '🔸 Форма нарушения',
        'viol:forms',
      ),
    ],
    [
      Keyboard.button.callback(
        draft.description ? 'Изменить описание' : '🔸 Добавить описание',
        'viol:desc',
      ),
    ],
  ];

  if (draft.photoToken) {
    rows.push([
      Keyboard.button.callback('Удалить фото', 'viol:photo:del'),
      Keyboard.button.callback('Изменить фото', 'viol:photo:edit'),
    ]);
  } else {
    rows.push([Keyboard.button.callback('Добавить фото (необязательно)', 'viol:photo:add')]);
  }

  const work = [
    Keyboard.button.callback('❌ Отмена', 'viol:cancel'),
    Keyboard.button.callback('⚠️ Сбросить', 'viol:reset'),
  ];
  if (draft.classId && draft.studentId && draft.formId && draft.description) {
    work.push(Keyboard.button.callback('✅ Отправить', 'viol:send', { intent: 'positive' }));
  }
  rows.push(work);
  return Keyboard.inlineKeyboard(rows);
}

export function createTaskMarkup(draft: {
  blockId?: number;
  place?: string;
  description?: string;
  technicianRoleId?: number;
  photoToken?: string;
}) {
  const rows = [
    [
      Keyboard.button.callback(draft.blockId ? 'Изменить блок' : '🔸 Выбрать блок', 'task:block'),
      Keyboard.button.callback(draft.place ? 'Изменить место' : '🔸 Добавить место', 'task:place'),
    ],
    [
      Keyboard.button.callback(
        draft.description ? 'Изменить описание' : '🔸 Добавить описание',
        'task:desc',
      ),
    ],
    [
      Keyboard.button.callback(
        draft.technicianRoleId ? 'Изменить тех. специалиста' : '🔸 Выбрать тех. специалиста',
        'task:tech',
      ),
    ],
  ];

  if (draft.photoToken) {
    rows.push([
      Keyboard.button.callback('Удалить фото', 'task:photo:del'),
      Keyboard.button.callback('Изменить фото', 'task:photo:edit'),
    ]);
  } else {
    rows.push([Keyboard.button.callback('Добавить фото', 'task:photo:add')]);
  }

  const work = [
    Keyboard.button.callback('❌ Отмена', 'task:cancel'),
    Keyboard.button.callback('⚠️ Сбросить', 'task:reset'),
  ];
  if (draft.blockId && draft.place && draft.description && draft.technicianRoleId) {
    work.push(Keyboard.button.callback('✅ Отправить', 'task:send', { intent: 'positive' }));
  }
  rows.push(work);
  return Keyboard.inlineKeyboard(rows);
}

export function chooseBlockMarkup() {
  return Keyboard.inlineKeyboard([
    BUILDING_BLOCKS.map((block) => Keyboard.button.callback(block.blockName, `task:block:${block.blockId}`)),
    [Keyboard.button.callback('⬅️ Назад', 'task:back')],
  ]);
}

export function chooseTechnicianMarkup() {
  const rows = TECHNICIAN_ROLES.map((roleId) => {
    const role = getRole(roleId);
    return [Keyboard.button.callback(role?.title ?? String(roleId), `task:tech:${roleId}`)];
  });
  rows.push([Keyboard.button.callback('⬅️ Назад', 'task:back')]);
  return Keyboard.inlineKeyboard(rows);
}

export function taskBackMarkup() {
  return Keyboard.inlineKeyboard([[Keyboard.button.callback('⬅️ Назад', 'task:back')]]);
}

export function viewTasksMarkup(tasks: TaskRecord[], page = 0) {
  const pageSize = 5;
  const start = page * pageSize;
  const slice = tasks.slice(start, start + pageSize);
  const rows = slice.map((task) => {
    const short = task.description.split(/\s+/).slice(0, 4).join(' ');
    return [Keyboard.button.callback(`#${task.taskId} ${short}`, `tasks:view:${task.taskId}`)];
  });

  if (tasks.length > pageSize) {
    const nav = [];
    nav.push(
      page > 0
        ? Keyboard.button.callback('«', `tasks:page:${page - 1}`)
        : Keyboard.button.callback(' ', 'ignore'),
    );
    nav.push(
      start + pageSize < tasks.length
        ? Keyboard.button.callback('»', `tasks:page:${page + 1}`)
        : Keyboard.button.callback(' ', 'ignore'),
    );
    rows.push(nav);
  }

  rows.push([Keyboard.button.callback('❌ Скрыть', 'tasks:hide')]);
  return Keyboard.inlineKeyboard(rows);
}

export function completeTaskMarkup(taskId: number) {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback('⬅️ Назад', 'tasks:list'),
      Keyboard.button.callback('✅ Выполнить', `tasks:done:${taskId}`, { intent: 'positive' }),
    ],
  ]);
}

export function employeesMarkup(employees: Employee[]) {
  const rows = employees.map((employee) => [
    Keyboard.button.callback(employee.fullname, `emp:show:${employee.employeeId}`),
  ]);
  rows.push([Keyboard.button.callback('❌ Закрыть', 'emp:close')]);
  return Keyboard.inlineKeyboard(rows);
}

export function editEmployeeMarkup(employeeId: number) {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('Удалить', `emp:del:${employeeId}`, { intent: 'negative' })],
    [Keyboard.button.callback('⬅️ К сотрудникам', 'emp:list')],
  ]);
}

export function blackListMarkup(index: number, total: number) {
  const rows = [];
  if (total > 1) {
    rows.push([
      index - 5 >= 0 ? Keyboard.button.callback('<<<', `bl:jump:${index - 5}`) : Keyboard.button.callback(' ', 'ignore'),
      index - 1 >= 0 ? Keyboard.button.callback('<', `bl:jump:${index - 1}`) : Keyboard.button.callback(' ', 'ignore'),
      index + 1 < total ? Keyboard.button.callback('>', `bl:jump:${index + 1}`) : Keyboard.button.callback(' ', 'ignore'),
      index + 5 < total ? Keyboard.button.callback('>>>', `bl:jump:${index + 5}`) : Keyboard.button.callback(' ', 'ignore'),
    ]);
  }
  rows.push([Keyboard.button.callback('Разблокировать', `bl:unlock:${index}`)]);
  rows.push([Keyboard.button.callback('Закрыть', 'bl:close')]);
  return Keyboard.inlineKeyboard(rows);
}
