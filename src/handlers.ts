import type { Bot, Context } from '@maxhub/max-bot-api';
import { ImageAttachment } from '@maxhub/max-bot-api';
import { formatRoles, getBlock, getReason, getRole, VIOLATION_FORMS, type ViolationFormId } from './catalog.js';
import { findChatIdByTitle, resetChatCache } from './chats.js';
import { config } from './config.js';
import {
  ack,
  escapeHtml,
  getMessageText,
  getPhotoToken,
  getUserId,
  prettyUsername,
  profileMentionHtml,
  sendFileWithRetry,
  sendHtml,
  sendInteractiveHtml,
  replaceHtml,
  sendMainMenu,
} from './helpers.js';
import {
  mainMenuKeyboard,
  MENU_TEXT,
  adminMenuKeyboard,
  blackListMarkup,
  chooseBlockMarkup,
  chooseTechnicianMarkup,
  classesMarkup,
  completeTaskMarkup,
  confirmBlockingMarkup,
  createTaskMarkup,
  createViolationMarkup,
  editEmployeeMarkup,
  employeesMarkup,
  reasonsMarkup,
  registrationMarkup,
  registrationRequestMarkup,
  rolesMarkup,
  studentsMarkup,
  taskBackMarkup,
  viewTasksMarkup,
  violationClassesMarkup,
  violationFormsMarkup,
  violationStudentsMarkup,
  withPersistentStart,
} from './keyboards.js';
import { createAbsenceReport, createViolationReport, handleAbsentData } from './reports.js';
import { loadStudentsFromExcel } from './students.js';
import {
  addAbsent,
  addEmployee,
  addRegistrationRequest,
  addTask,
  blockUser,
  classifyRoles,
  clearSession,
  closeRegistrationRequest,
  completeTask,
  countStudentsByClass,
  deleteEmployee,
  formatDateRu,
  getAdmins,
  getAllClasses,
  getAllEmployees,
  getBlockedUsers,
  getClass,
  getEmployee,
  getEmployeeByUserId,
  getEmployeeRoles,
  getEmployeesByRole,
  findEmployeesByNameParts,
  getPendingRequestByUserId,
  getRequest,
  getSession,
  getStudent,
  getStudentsByClass,
  getTask,
  getTasksByRoles,
  notMarkedClasses,
  setClassLastDate,
  setEmployeeRole,
  setSession,
  todayIso,
  unlockUser,
  userBlocked,
  type Employee,
  type TaskDraft,
  type ViolationDraft,
} from './storage.js';

let botRef: Bot;

function isStartTrigger(ctx: Context, text?: string): boolean {
  if (ctx.updateType === 'bot_started') return true;
  if (text === MENU_TEXT.start || (text && /^старт$/i.test(text))) return true;
  if (text === 'start' || text === '/start') return true;
  const attachments = ctx.message?.body.attachments ?? [];
  for (const item of attachments) {
    const raw = item as { type?: string; payload?: unknown };
    if (raw.payload === 'start' || raw.payload === 'menu') return true;
    if (typeof raw.payload === 'object' && raw.payload && 'data' in raw.payload) {
      const data = String((raw.payload as { data?: string }).data ?? '');
      if (data === 'start' || data === 'menu') return true;
    }
  }
  return false;
}

async function deliverStartMenu(bot: Bot, userId: number, ctx?: Context): Promise<void> {
  if (await userBlocked(userId)) {
    const text = '🙅‍♂️ Администраторы добавили вас в черный список';
    if (ctx && ctx.updateType !== 'bot_started') await sendHtml(ctx, text);
    else await bot.api.sendMessageToUser(userId, text, { format: 'html' });
    return;
  }

  await clearSession(userId);
  const employee = await getEmployeeByUserId(userId);

  if (employee) {
    const roles = await getEmployeeRoles(employee.employeeId);
    const text = 'Вы в главном меню';
    const attachments = withPersistentStart([mainMenuKeyboard(roles)]) as never;
    if (ctx && ctx.updateType !== 'bot_started') {
      await sendHtml(ctx, text, [mainMenuKeyboard(roles)]);
    } else {
      await bot.api.sendMessageToUser(userId, text, { format: 'html', attachments });
    }
    return;
  }

  if (await getPendingRequestByUserId(userId)) {
    const text = 'Ваша заявка на регистрацию пока не одобрена. Попробуйте позже';
    if (ctx && ctx.updateType !== 'bot_started') await sendHtml(ctx, text);
    else await bot.api.sendMessageToUser(userId, text, { format: 'html' });
    return;
  }

  const text = [
    '👋 Приветствую Вас в официальном боте ГАОУ "Лицей Иннополис"!',
    '',
    'Меню открыто. Для заявки — <b>Регистрация</b>.',
  ].join('\n');
  const attachments = withPersistentStart([registrationMarkup()]) as never;
  if (ctx && ctx.updateType !== 'bot_started') {
    await sendHtml(ctx, text, [registrationMarkup()]);
  } else {
    await bot.api.sendMessageToUser(userId, text, { format: 'html', attachments });
  }
}

function taskSummary(draft: TaskDraft): string {
  const block = draft.blockId ? getBlock(draft.blockId)?.blockName : undefined;
  const technician = draft.technicianRoleId ? getRole(draft.technicianRoleId)?.title : undefined;
  return [
    '<b>Создание заявки</b>',
    '',
    `<b>Блок:</b> ${block ?? '—'}`,
    `<b>Место/Кабинет:</b> ${draft.place ?? '—'}`,
    `<b>Описание:</b> ${draft.description ?? '—'}`,
    `<b>Фото:</b> ${draft.photoToken ? 'Присутствует' : 'Отсутствует'}`,
    `<b>Тех. специалист:</b> ${technician ?? '—'}`,
  ].join('\n');
}

async function sendTaskPanel(ctx: Context, draft: TaskDraft): Promise<void> {
  const text = taskSummary(draft);
  const keyboard = createTaskMarkup(draft);
  const attachments = draft.photoToken
    ? [new ImageAttachment({ token: draft.photoToken }).toJson(), keyboard]
    : [keyboard];
  await sendHtml(ctx, text, attachments);
}

async function notifyAdmins(bot: Bot, text: string, attachments?: unknown[]): Promise<void> {
  const adminEmployeeIds = await getAdmins();
  const userIds = new Set(config.adminIds);
  for (const employeeId of adminEmployeeIds) {
    const employee = await getEmployee(employeeId);
    if (employee) userIds.add(employee.userId);
  }
  if (userIds.size === 0) {
    console.error('No admin recipients configured for registration notify');
    return;
  }
  for (const userId of userIds) {
    try {
      await bot.api.sendMessageToUser(userId, text, {
        format: 'html',
        attachments: attachments as never,
      });
    } catch (error) {
      console.error(`Failed to notify admin ${userId} with attachments:`, error);
      try {
        await bot.api.sendMessageToUser(userId, text, { format: 'html' });
        if (attachments?.length) {
          await bot.api.sendMessageToUser(userId, 'Действия по заявке:', {
            attachments: attachments as never,
          });
        }
      } catch (fallbackError) {
        console.error(`Failed to notify admin ${userId}:`, fallbackError);
      }
    }
  }
}

async function resolveViolationRecipients(formId: ViolationFormId): Promise<Employee[]> {
  const recipients = new Map<number, Employee>();

  // И админам всегда
  for (const employeeId of await getAdmins()) {
    const employee = await getEmployee(employeeId);
    if (employee) recipients.set(employee.userId, employee);
  }
  for (const adminId of config.adminIds) {
    const employee = await getEmployeeByUserId(adminId);
    if (employee) recipients.set(employee.userId, employee);
    else {
      recipients.set(adminId, {
        employeeId: 0,
        userId: adminId,
        fullname: 'Администратор',
      });
    }
  }

  const nameQueries =
    formId === 'discipline'
      ? config.violationDisciplineRecipients
      : config.violationStudyRecipients;

  for (const nameQuery of nameQueries) {
    for (const employee of await findEmployeesByNameParts(nameQuery)) {
      recipients.set(employee.userId, employee);
    }
  }

  return [...recipients.values()];
}

async function requireEmployee(ctx: Context) {
  const userId = getUserId(ctx);
  if (!userId) return undefined;
  if (await userBlocked(userId)) {
    await sendHtml(ctx, '🙅‍♂️ Администраторы добавили вас в черный список');
    return undefined;
  }
  const employee = await getEmployeeByUserId(userId);
  if (!employee) {
    await sendHtml(ctx, 'Сначала нажмите кнопку Старт или пройдите регистрацию.');
    return undefined;
  }
  return { userId, employee, roles: await getEmployeeRoles(employee.employeeId) };
}

async function handleStart(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) return;
  if (ctx.updateType === 'message_callback') await ack(ctx);
  await deliverStartMenu(botRef, userId, ctx);
}

async function startRegistration(ctx: Context): Promise<void> {
  const userId = getUserId(ctx);
  if (!userId) return;
  if (await getEmployeeByUserId(userId) || await getPendingRequestByUserId(userId)) {
    await sendHtml(ctx, 'Вы уже отправили заявку на регистрацию');
    return;
  }
  await setSession(userId, { step: 'registration_wait_name', rolesChosen: [] });
  await sendHtml(
    ctx,
    'Введите <b>ФИО</b> через пробел без дополнительных символов.\n<b>Например:</b> Иванов Максим Игоревич',
  );
}

async function openAdminMenu(ctx: Context): Promise<void> {
  const auth = await requireEmployee(ctx);
  if (!auth || !classifyRoles(auth.roles).isAdmin) {
    await sendHtml(ctx, 'Эта команда доступна только администратору.');
    return;
  }
  await sendHtml(ctx, 'Выберите действие', [adminMenuKeyboard()]);
}

async function openAbsents(ctx: Context): Promise<void> {
  const auth = await requireEmployee(ctx);
  if (!auth || !classifyRoles(auth.roles).canMarkAbsents) {
    await sendHtml(ctx, 'Недостаточно прав для отметки отсутствующих.');
    return;
  }
  const classes = await notMarkedClasses();
  if (classes.length === 0) {
    await sendHtml(ctx, 'За сегодня все классы уже отмечены');
    return;
  }
  await setSession(auth.userId, { absents: [] });
  await sendInteractiveHtml(ctx, 'Выберите класс', [classesMarkup(classes)]);
}

async function openRepair(ctx: Context): Promise<void> {
  const auth = await requireEmployee(ctx);
  if (!auth) return;
  const draft: TaskDraft = {};
  await setSession(auth.userId, { task: draft });
  await sendTaskPanel(ctx, draft);
}

async function openTasks(ctx: Context): Promise<void> {
  const auth = await requireEmployee(ctx);
  if (!auth || !classifyRoles(auth.roles).isTechnician) {
    await sendHtml(ctx, 'Недостаточно прав для просмотра задач.');
    return;
  }
  const tasks = await getTasksByRoles(auth.roles);
  if (tasks.length === 0) {
    await sendHtml(ctx, 'Список задач пуст');
    return;
  }
  await sendHtml(ctx, 'Список задач', [viewTasksMarkup(tasks, 0)]);
}

function violationSummary(draft: ViolationDraft, className?: string, studentName?: string): string {
  const formTitle = VIOLATION_FORMS.find((item) => item.formId === draft.formId)?.title;
  return [
    '<b>Правонарушение учащегося</b>',
    '',
    `<b>Класс:</b> ${className ?? '—'}`,
    `<b>Ученик:</b> ${studentName ?? '—'}`,
    `<b>Форма:</b> ${formTitle ?? '—'}`,
    `<b>Описание:</b> ${draft.description ?? '—'}`,
    `<b>Фото:</b> ${draft.photoToken ? 'Присутствует' : 'Отсутствует'}`,
  ].join('\n');
}

async function sendViolationPanel(ctx: Context, draft: ViolationDraft, mode: 'replace' | 'send' = 'send'): Promise<void> {
  const classRecord = draft.classId ? await getClass(draft.classId) : undefined;
  const student = draft.studentId ? await getStudent(draft.studentId) : undefined;
  const studentName = student
    ? `${student.surname} ${student.name}${student.middlename ? ` ${student.middlename}` : ''}`
    : undefined;
  const text = violationSummary(draft, classRecord?.className, studentName);
  const keyboard = createViolationMarkup(draft);
  const attachments = draft.photoToken
    ? [new ImageAttachment({ token: draft.photoToken }).toJson(), keyboard]
    : [keyboard];
  if (mode === 'replace') {
    await replaceHtml(ctx, text, attachments);
    return;
  }
  await sendInteractiveHtml(ctx, text, attachments);
}

async function openViolations(ctx: Context): Promise<void> {
  const auth = await requireEmployee(ctx);
  if (!auth || !classifyRoles(auth.roles).canMarkViolations) {
    await sendHtml(ctx, 'Недостаточно прав для оформления правонарушений.');
    return;
  }
  const classes = await getAllClasses();
  if (classes.length === 0) {
    await sendHtml(ctx, 'Список классов пуст. Загрузите учеников.');
    return;
  }
  await setSession(auth.userId, { violation: {} });
  if (ctx.updateType === 'message_callback') {
    await replaceHtml(ctx, 'Выберите класс', [violationClassesMarkup(classes)]);
  } else {
    await sendInteractiveHtml(ctx, 'Выберите класс', [violationClassesMarkup(classes)]);
  }
}

export function registerHandlers(bot: Bot): void {
  botRef = bot;
  bot.command('start', handleStart);
  bot.command('menu', handleStart);
  bot.on('bot_started', handleStart);
  bot.action('go:start', handleStart);

  bot.command('myid', async (ctx) => {
    const userId = getUserId(ctx);
    if (userId) await sendHtml(ctx, `Ваш ID: <code>${userId}</code>`);
  });

  bot.action('ignore', async (ctx) => {
    await ack(ctx);
  });

  bot.action('reg:start', async (ctx) => {
    await startRegistration(ctx);
  });

  bot.action(/^reg:role:(\d+)$/, async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const roleId = Number(ctx.match?.[1]);
    const session = await getSession(userId);
    const chosen = new Set(session.rolesChosen ?? []);
    if (chosen.has(roleId)) chosen.delete(roleId);
    else chosen.add(roleId);
    session.rolesChosen = [...chosen];
    await setSession(userId, session);
    const count = session.rolesChosen.length;
    const hint =
      count > 0
        ? `Выбрано: <b>${count}</b>. Можно выбрать ещё или нажмите <b>Готово</b>.`
        : 'Выберите хотя бы одну должность, затем нажмите <b>Готово</b>.';
    await replaceHtml(ctx, `Выберите Вашу должность (можно несколько)\n\n${hint}`, [
      rolesMarkup(session.rolesChosen),
    ]);
  });

  bot.action('reg:done', async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    const session = await getSession(userId);
    const fio = session.fio;
    const rolesChosen = session.rolesChosen ?? [];
    if (!fio || rolesChosen.length === 0) {
      await replaceHtml(
        ctx,
        'Сначала выберите хотя бы одну должность, затем нажмите <b>Готово</b>.',
        [rolesMarkup(rolesChosen)],
        'Выберите должность',
      );
      return;
    }
    if (await getEmployeeByUserId(userId) || await getPendingRequestByUserId(userId)) {
      await clearSession(userId);
      await replaceHtml(ctx, 'Вы уже отправили заявку на регистрацию');
      return;
    }

    const request = await addRegistrationRequest(userId, fio, ctx.user?.username, rolesChosen);
    const prettyRoles = formatRoles(rolesChosen);
    await clearSession(userId);
    await replaceHtml(
      ctx,
      `📨 Ваша заявка отправлена и будет рассмотрена администраторами\n\n<b>ФИО:</b> ${fio}\n<b>Должности:</b> ${prettyRoles}`,
    );
    const username = ctx.user?.username;
    const maxProfileName = (ctx.user?.name ?? '').trim() || fio;
    await notifyAdmins(
      bot,
      [
        '📩 Получена заявка на регистрацию',
        '',
        `<b>ФИО (заявка):</b> ${fio}`,
        `<b>Должности:</b> ${prettyRoles}`,
        `<b>MAX ID:</b> <code>${userId}</code>`,
        `<b>Username:</b> ${prettyUsername(username)}`,
        `<b>Профиль MAX:</b> ${profileMentionHtml(userId, maxProfileName)}`,
        '',
        'Нажмите на имя в строке «Профиль MAX», чтобы открыть аккаунт.',
      ].join('\n'),
      [registrationRequestMarkup(request.requestId)],
    );
  });

  bot.action(/^reg:accept:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) {
      await ack(ctx, 'Недостаточно прав');
      return;
    }
    const request = await getRequest(Number(ctx.match?.[1]));
    if (!request || request.status !== 'pending') {
      await ack(ctx, 'Заявка уже обработана');
      await sendHtml(ctx, 'Заявка не найдена или уже обработана.');
      return;
    }
    const employee = await addEmployee(request.userId, request.fromName, request.fromUsername);
    for (const roleId of request.roles) await setEmployeeRole(employee.employeeId, roleId);
    await closeRegistrationRequest(request.requestId);
    await ack(ctx, 'Сотрудник добавлен');
    await sendHtml(ctx, 'Сотрудник добавлен');
    const roles = await getEmployeeRoles(employee.employeeId);
    try {
      await bot.api.sendMessageToUser(
        request.userId,
        [
          '✅ Ваш запрос на регистрацию одобрен!',
          '',
          'Нажмите <b>Старт</b> внизу этого сообщения, чтобы открыть меню.',
        ].join('\n'),
        {
          format: 'html',
          attachments: withPersistentStart([mainMenuKeyboard(roles)]) as never,
        },
      );
    } catch (error) {
      console.error('Failed to notify approved user:', error);
    }
  });

  bot.action(/^reg:reject:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) {
      await ack(ctx, 'Недостаточно прав');
      return;
    }
    const requestId = Number(ctx.match?.[1]);
    await ack(ctx);
    await sendHtml(ctx, 'Запрос отклонен');
    await sendHtml(ctx, 'Добавить пользователя в черный список?', [confirmBlockingMarkup(requestId)]);
  });

  bot.action(/^reg:block:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const request = await getRequest(Number(ctx.match?.[1]));
    if (!request) return;
    await blockUser(request.userId, request.fromName, request.fromUsername);
    await closeRegistrationRequest(request.requestId);
    await ack(ctx, 'Пользователь заблокирован');
    await sendHtml(ctx, '🔏 Пользователь заблокирован');
    try {
      await bot.api.sendMessageToUser(request.userId, 'Ваш запрос на регистрацию отклонен');
    } catch (error) {
      console.error(error);
    }
  });

  bot.action(/^reg:noblock:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const request = await getRequest(Number(ctx.match?.[1]));
    if (!request) return;
    await closeRegistrationRequest(request.requestId);
    await ack(ctx);
    await sendHtml(ctx, 'Запрос отклонен без блокировки');
    try {
      await bot.api.sendMessageToUser(request.userId, 'Ваш запрос на регистрацию отклонен');
    } catch (error) {
      console.error(error);
    }
  });

  bot.action('menu:main', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await clearSession(auth.userId);
    await sendMainMenu(ctx, auth.userId);
  });

  bot.action('menu:admin', async (ctx) => {
    await openAdminMenu(ctx);
  });

  bot.action('menu:absents', async (ctx) => {
    await openAbsents(ctx);
  });

  bot.action(/^abs:class:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkAbsents) return;
    const classId = Number(ctx.match?.[1]);
    const classRecord = await getClass(classId);
    if (!classRecord) return;
    if (classRecord.lastDate === todayIso()) {
      const classes = await notMarkedClasses();
      await replaceHtml(ctx, 'Выберите класс', [classesMarkup(classes)], 'Класс уже отмечен');
      return;
    }
    const session = await getSession(auth.userId);
    session.classId = classId;
    session.absents = [];
    session.studentId = undefined;
    await setSession(auth.userId, session);
    const students = await getStudentsByClass(classId);
    const total = await countStudentsByClass(classId);
    await replaceHtml(
      ctx,
      `Выберите отсутствующих\nВ классе: <b>${total} из ${total}</b>`,
      [studentsMarkup(students, [])],
    );
  });

  bot.action(/^abs:st:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkAbsents) return;
    const studentId = Number(ctx.match?.[1]);
    const session = await getSession(auth.userId);
    const classId = session.classId;
    if (!classId) return;
    const absents = session.absents ?? [];
    if (absents.some((item) => item.studentId === studentId)) {
      session.absents = absents.filter((item) => item.studentId !== studentId);
      await setSession(auth.userId, session);
      const students = await getStudentsByClass(classId);
      const total = await countStudentsByClass(classId);
      const present = total - (session.absents?.length ?? 0);
      await replaceHtml(
        ctx,
        `Выберите отсутствующих\nВ классе: <b>${present} из ${total}</b>`,
        [studentsMarkup(students, session.absents ?? [])],
      );
      return;
    }
    session.studentId = studentId;
    await setSession(auth.userId, session);
    await replaceHtml(ctx, 'Выберите причину отсутствия', [reasonsMarkup()]);
  });

  bot.action(/^abs:reason:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkAbsents) return;
    const reasonId = Number(ctx.match?.[1]);
    const session = await getSession(auth.userId);
    if (!session.classId || !session.studentId) return;
    session.absents = [...(session.absents ?? []), { studentId: session.studentId, reasonId }];
    session.studentId = undefined;
    await setSession(auth.userId, session);
    const students = await getStudentsByClass(session.classId);
    const total = await countStudentsByClass(session.classId);
    const present = total - session.absents.length;
    await replaceHtml(
      ctx,
      `Выберите отсутствующих\nВ классе: <b>${present} из ${total}</b>`,
      [studentsMarkup(students, session.absents)],
    );
  });

  bot.action('abs:classes', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkAbsents) return;
    await setSession(auth.userId, { absents: [] });
    await replaceHtml(ctx, 'Выберите класс', [classesMarkup(await notMarkedClasses())]);
  });

  bot.action('abs:students', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkAbsents) return;
    const session = await getSession(auth.userId);
    if (!session.classId) return;
    session.studentId = undefined;
    await setSession(auth.userId, session);
    const students = await getStudentsByClass(session.classId);
    const total = await countStudentsByClass(session.classId);
    const present = total - (session.absents?.length ?? 0);
    await replaceHtml(
      ctx,
      `Выберите отсутствующих\nВ классе: <b>${present} из ${total}</b>`,
      [studentsMarkup(students, session.absents ?? [])],
    );
  });

  bot.action('abs:cancel', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await clearSession(auth.userId);
    await ack(ctx);
    const roles = await getEmployeeRoles(auth.employee.employeeId);
    await sendHtml(ctx, 'Отменено', [mainMenuKeyboard(roles)]);
  });

  bot.action('abs:done', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    const classId = session.classId;
    const absents = session.absents ?? [];
    if (!classId) return;
    const classRecord = await getClass(classId);
    if (!classRecord) return;
    if (classRecord.lastDate === todayIso()) {
      const roles = await getEmployeeRoles(auth.employee.employeeId);
      await sendHtml(ctx, `${classRecord.className} класс уже был отмечен ранее`, [mainMenuKeyboard(roles)]);
      return;
    }

    await setClassLastDate(classId);
    const pretty: string[] = [];
    for (const item of absents) {
      await addAbsent(item.reasonId, item.studentId);
      const student = await getStudent(item.studentId);
      const reason = getReason(item.reasonId);
      pretty.push(`${student?.surname ?? ''} ${student?.name ?? ''} (${reason?.title ?? ''})`.trim());
    }
    await clearSession(auth.userId);
    const roles = await getEmployeeRoles(auth.employee.employeeId);
    await ack(ctx, 'Класс отмечен');
    await sendHtml(ctx, `Отмечен ${classRecord.className} класс`, [mainMenuKeyboard(roles)]);

    const remaining = await notMarkedClasses();
    const total = await countStudentsByClass(classId);
    const present = total - absents.length;
    let classText =
      `${auth.employee.fullname} отправил(-а) информацию по <b>${classRecord.className}</b> классу\n\n` +
      `Учеников в классе: <b>${present} из ${total}</b>`;
    if (pretty.length) classText += `\n\nОтсутствующие: ${pretty.join(', ')}`;

    // После каждого класса — в группу заявок
    let tasksChatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
    if (!tasksChatId) {
      resetChatCache(config.tasksChatTitle);
      tasksChatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
    }
    if (tasksChatId) {
      try {
        await bot.api.sendMessageToChat(tasksChatId, classText, { format: 'html' });
      } catch (error) {
        console.error('Failed to send class info to tasks chat:', error);
        resetChatCache(config.tasksChatTitle);
      }
    } else {
      console.warn(`Chat "${config.tasksChatTitle}" not found`);
    }

    let studentsChatId = await findChatIdByTitle(bot.api, config.studentsInfoChatTitle);
    if (!studentsChatId) {
      resetChatCache(config.studentsInfoChatTitle);
      studentsChatId = await findChatIdByTitle(bot.api, config.studentsInfoChatTitle);
    }

    if (remaining.length === 0) {
      const stats = await handleAbsentData();
      const dateRu = formatDateRu();
      const summary =
        `Все классы отмечены за <b>${dateRu}</b>\nВсего в лицее: <b>${stats.allInLyceum} из ${stats.allStudents}</b>`;
      const caption = `Отчёт по отсутствующим за ${dateRu}`;

      // В группу «Информация по детям» — только итоговая сводка
      if (studentsChatId) {
        try {
          await bot.api.sendMessageToChat(studentsChatId, summary, { format: 'html' });
        } catch (error) {
          console.error('Failed to send lyceum info:', error);
        }
      } else {
        console.warn(`Chat "${config.studentsInfoChatTitle}" not found`);
      }

      const reportPath = await createAbsenceReport();
      if (reportPath) {
        for (const employeeId of await getAdmins()) {
          const admin = await getEmployee(employeeId);
          if (!admin) continue;
          await sendFileWithRetry(async () => {
            const file = await bot.api.uploadFile({ source: reportPath });
            await bot.api.sendMessageToUser(admin.userId, caption, {
              attachments: [file.toJson()],
            });
          }, `Failed to send Word report to admin ${admin.userId}`);
        }

        if (config.absenceReportToTasksChat) {
          if (!tasksChatId) {
            resetChatCache(config.tasksChatTitle);
            tasksChatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
          }
          if (tasksChatId) {
            const chatIdForReport = tasksChatId;
            await sendFileWithRetry(async () => {
              const file = await bot.api.uploadFile({ source: reportPath });
              await bot.api.sendMessageToChat(chatIdForReport, caption, {
                attachments: [file.toJson()],
              });
            }, 'Failed to send Word report to tasks chat');
          } else {
            console.warn(`Chat "${config.tasksChatTitle}" not found for temporary absence report`);
          }
        }
      }
    }
  });

  bot.action('menu:repair', async (ctx) => {
    await openRepair(ctx);
  });

  bot.action('menu:violations', async (ctx) => {
    await openViolations(ctx);
  });

  bot.action('viol:cancel', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await clearSession(auth.userId);
    await ack(ctx);
    await sendMainMenu(ctx, auth.userId, 'Оформление правонарушения отменено');
  });

  bot.action('viol:reset', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await setSession(auth.userId, { violation: {} });
    await sendViolationPanel(ctx, {}, 'replace');
  });

  bot.action('viol:classes', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    await replaceHtml(ctx, 'Выберите класс', [violationClassesMarkup(await getAllClasses())]);
  });

  bot.action(/^viol:class:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const classId = Number(ctx.match?.[1]);
    const session = await getSession(auth.userId);
    session.violation = { ...(session.violation ?? {}), classId, studentId: undefined, formId: undefined };
    await setSession(auth.userId, session);
    const students = await getStudentsByClass(classId);
    if (!students.length) {
      await replaceHtml(ctx, 'В этом классе нет учеников', [violationClassesMarkup(await getAllClasses())]);
      return;
    }
    await replaceHtml(ctx, 'Выберите ученика', [violationStudentsMarkup(students)]);
  });

  bot.action('viol:students', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    const classId = session.violation?.classId;
    if (!classId) {
      await replaceHtml(ctx, 'Сначала выберите класс', [violationClassesMarkup(await getAllClasses())], 'Сначала класс');
      return;
    }
    await replaceHtml(ctx, 'Выберите ученика', [violationStudentsMarkup(await getStudentsByClass(classId))]);
  });

  bot.action(/^viol:st:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const studentId = Number(ctx.match?.[1]);
    const session = await getSession(auth.userId);
    session.violation = { ...(session.violation ?? {}), studentId, formId: undefined };
    await setSession(auth.userId, session);
    const student = await getStudent(studentId);
    const studentLabel = student
      ? `${student.surname} ${student.name}${student.middlename ? ` ${student.middlename}` : ''}`
      : 'ученик выбран';
    // Список детей заменяется на выбор формы в том же сообщении
    await replaceHtml(
      ctx,
      `Ученик: <b>${escapeHtml(studentLabel)}</b>\n\nВыберите форму нарушения`,
      [violationFormsMarkup()],
    );
  });

  bot.action('viol:forms', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    await replaceHtml(ctx, 'Выберите форму нарушения', [violationFormsMarkup()]);
  });

  bot.action(/^viol:form:(discipline|study)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const formId = ctx.match?.[1] as ViolationFormId;
    const session = await getSession(auth.userId);
    session.violation = { ...(session.violation ?? {}), formId };
    session.step = undefined;
    await setSession(auth.userId, session);
    await sendViolationPanel(ctx, session.violation, 'replace');
  });

  bot.action('viol:desc', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    session.step = 'create_violation_wait_description';
    await setSession(auth.userId, session);
    await replaceHtml(ctx, 'Опишите нарушение одним сообщением', [createViolationMarkup(session.violation ?? {})]);
  });

  bot.action('viol:photo:add', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    session.step = 'create_violation_wait_photo';
    await setSession(auth.userId, session);
    await replaceHtml(
      ctx,
      'Пришлите фотографию одним сообщением (необязательно)',
      [createViolationMarkup(session.violation ?? {})],
    );
  });

  bot.action('viol:photo:edit', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    session.step = 'create_violation_wait_photo';
    await setSession(auth.userId, session);
    await replaceHtml(ctx, 'Пришлите новое фото одним сообщением', [createViolationMarkup(session.violation ?? {})]);
  });

  bot.action('viol:photo:del', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    if (session.violation) delete session.violation.photoToken;
    session.step = undefined;
    await setSession(auth.userId, session);
    await sendViolationPanel(ctx, session.violation ?? {}, 'replace');
  });

  bot.action('viol:send', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).canMarkViolations) return;
    const session = await getSession(auth.userId);
    const draft = session.violation ?? {};
    if (!draft.classId || !draft.studentId || !draft.formId || !draft.description) {
      await ack(ctx, 'Заполните все обязательные поля');
      return;
    }
    const classRecord = await getClass(draft.classId);
    const student = await getStudent(draft.studentId);
    if (!classRecord || !student) {
      await ack(ctx, 'Ученик или класс не найден');
      return;
    }
    const studentFullName = `${student.surname} ${student.name}${student.middlename ? ` ${student.middlename}` : ''}`.trim();
    const formTitle = VIOLATION_FORMS.find((item) => item.formId === draft.formId)?.title ?? draft.formId;
    const reportPath = await createViolationReport({
      studentFullName,
      className: classRecord.className,
      formId: draft.formId,
      description: draft.description,
      authorFullName: auth.employee.fullname,
    });
    await clearSession(auth.userId);
    if (!reportPath) {
      await ack(ctx, 'Ошибка формирования документа');
      await sendHtml(ctx, 'Не удалось сформировать Word-документ. Попробуйте снова.');
      return;
    }

    await ack(ctx, 'Документ отправлен');
    await sendMainMenu(ctx, auth.userId, 'Правонарушение оформлено и отправлено руководству');

    const caption =
      `Правонарушение: ${studentFullName}, ${classRecord.className}\n` +
      `Форма: ${formTitle}\n` +
      `Составил: ${auth.employee.fullname}\n` +
      `Описание: ${draft.description}`;

    const recipientsMap = new Map<number, Employee>();
    for (const recipient of await resolveViolationRecipients(draft.formId)) {
      recipientsMap.set(recipient.userId, recipient);
    }
    recipientsMap.set(auth.userId, auth.employee);
    const recipients = [...recipientsMap.values()];

    if (!recipients.length) {
      console.warn(
        `No recipients found for violation form "${draft.formId}". ` +
          'Register Анна Олеговна / Светлана Вячеславовна or set ADMIN_IDS.',
      );
      await sendHtml(
        ctx,
        'Документ создан, но получатели не найдены в базе. Убедитесь, что нужные сотрудники зарегистрированы.',
      );
    }

    for (const recipient of recipients) {
      await sendFileWithRetry(async () => {
        const file = await bot.api.uploadFile({ source: reportPath });
        const attachments = draft.photoToken
          ? [file.toJson(), new ImageAttachment({ token: draft.photoToken }).toJson()]
          : [file.toJson()];
        await bot.api.sendMessageToUser(recipient.userId, caption, {
          attachments,
        });
      }, `Failed to send violation report to ${recipient.fullname} (${recipient.userId})`);
    }
  });

  bot.action('task:block', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await sendHtml(ctx, '<b>Создание заявки</b>\n\nВыберите блок', [chooseBlockMarkup()]);
  });

  bot.action(/^task:block:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.task = { ...(session.task ?? {}), blockId: Number(ctx.match?.[1]) };
    session.step = undefined;
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendTaskPanel(ctx, session.task);
  });

  bot.action('task:place', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.step = 'create_task_wait_place';
    await setSession(auth.userId, session);
    await ack(ctx);
    const current = session.task?.place;
    const text = current
      ? `<b>Создание заявки</b>\n\n<code>${current}</code>\n\nВведите новое место или кабинет`
      : '<b>Создание заявки</b>\n\nВведите место или кабинет';
    await sendHtml(ctx, text, [taskBackMarkup()]);
  });

  bot.action('task:desc', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.step = 'create_task_wait_description';
    await setSession(auth.userId, session);
    await ack(ctx);
    const current = session.task?.description;
    const text = current
      ? `<b>Создание заявки</b>\n\n<code>${current}</code>\n\nВведите новое описание проблемы`
      : '<b>Создание заявки</b>\n\nВведите описание проблемы';
    await sendHtml(ctx, text, [taskBackMarkup()]);
  });

  bot.action('task:tech', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await sendHtml(ctx, '<b>Создание заявки</b>\n\nВыберите технического специалиста', [chooseTechnicianMarkup()]);
  });

  bot.action(/^task:tech:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.task = { ...(session.task ?? {}), technicianRoleId: Number(ctx.match?.[1]) };
    session.step = undefined;
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendTaskPanel(ctx, session.task);
  });

  bot.action('task:photo:add', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.step = 'create_task_wait_photo';
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendHtml(ctx, '<b>Создание заявки</b>\n\nОтправьте фото проблемы', [taskBackMarkup()]);
  });

  bot.action('task:photo:edit', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.step = 'create_task_wait_photo';
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendHtml(ctx, '<b>Создание заявки</b>\n\nОтправьте новое фото', [taskBackMarkup()]);
  });

  bot.action('task:photo:del', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    const task = { ...(session.task ?? {}) };
    delete task.photoToken;
    session.task = task;
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendTaskPanel(ctx, task);
  });

  bot.action('task:back', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    session.step = undefined;
    await setSession(auth.userId, session);
    await ack(ctx);
    await sendTaskPanel(ctx, session.task ?? {});
  });

  bot.action('task:cancel', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await clearSession(auth.userId);
    await ack(ctx);
    await sendMainMenu(ctx, auth.userId, 'Создание заявки отменено');
  });

  bot.action('task:reset', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await setSession(auth.userId, { task: {} });
    await ack(ctx);
    await sendTaskPanel(ctx, {});
  });

  bot.action('task:send', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const session = await getSession(auth.userId);
    const draft = session.task ?? {};
    if (!draft.blockId || !draft.place || !draft.description || !draft.technicianRoleId) {
      await ack(ctx, 'Заполните все поля');
      return;
    }
    const task = await addTask({
      createdDate: todayIso(),
      createdBy: auth.employee.employeeId,
      description: draft.description,
      buildingBlock: draft.blockId,
      technicianRole: draft.technicianRoleId,
      place: draft.place,
      hasPhoto: Boolean(draft.photoToken),
      photoToken: draft.photoToken,
    });
    await clearSession(auth.userId);
    await ack(ctx, 'Заявка отправлена');
    await sendMainMenu(ctx, auth.userId, 'Заявка отправлена');

    for (const employeeId of await getEmployeesByRole(draft.technicianRoleId)) {
      const employee = await getEmployee(employeeId);
      if (!employee) continue;
      try {
        await bot.api.sendMessageToUser(employee.userId, '📩 У вас новая задача. Проверьте список задач');
      } catch (error) {
        console.error(`Failed to notify technician ${employee.userId}:`, error);
      }
    }

    const chatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
    if (!chatId) {
      console.warn(`Chat "${config.tasksChatTitle}" not found`);
      return;
    }
    const block = getBlock(draft.blockId);
    const technician = getRole(draft.technicianRoleId);
    const text = [
      `<b>Заявка от ${formatDateRu()}</b>`,
      `<b>Создал:</b> <i>${auth.employee.fullname}</i>`,
      '',
      `<b>Блок:</b> ${block?.blockName ?? '—'}`,
      `<b>Место/Кабинет:</b> ${draft.place}`,
      `<b>Описание:</b> ${draft.description}`,
      `<b>Фото:</b> ${draft.photoToken ? 'Присутствует' : 'Отсутствует'}`,
      `<b>Тех. специалист:</b> ${technician?.title ?? '—'}`,
      '',
      `#Задача #${task.taskId}`,
    ].join('\n');
    try {
      if (draft.photoToken) {
        await bot.api.sendMessageToChat(chatId, text, {
          format: 'html',
          attachments: [new ImageAttachment({ token: draft.photoToken }).toJson()],
        });
      } else {
        await bot.api.sendMessageToChat(chatId, text, { format: 'html' });
      }
    } catch (error) {
      console.error('Failed to send task to group:', error);
      resetChatCache(config.tasksChatTitle);
    }
  });

  bot.action('menu:tasks', async (ctx) => {
    await openTasks(ctx);
  });

  bot.action(/^tasks:page:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const page = Number(ctx.match?.[1]);
    const tasks = await getTasksByRoles(auth.roles);
    await ack(ctx);
    await sendHtml(ctx, 'Список задач', [viewTasksMarkup(tasks, page)]);
  });

  bot.action('tasks:hide', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await sendMainMenu(ctx, auth.userId, 'Список скрыт');
  });

  bot.action('tasks:list', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const tasks = await getTasksByRoles(auth.roles);
    await ack(ctx);
    await sendHtml(ctx, 'Список задач', [viewTasksMarkup(tasks, 0)]);
  });

  bot.action(/^tasks:view:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const task = await getTask(Number(ctx.match?.[1]));
    if (!task) return;
    const block = getBlock(task.buildingBlock);
    const technician = getRole(task.technicianRole);
    const text = [
      '<b>Заявка</b>',
      '',
      `<b>Блок:</b> ${block?.blockName ?? '—'}`,
      `<b>Место/Кабинет:</b> ${task.place}`,
      `<b>Описание:</b> ${task.description}`,
      `<b>Фото:</b> ${task.hasPhoto ? 'Присутствует' : 'Отсутствует'}`,
      `<b>Тех. специалист:</b> ${technician?.title ?? '—'}`,
    ].join('\n');
    await ack(ctx);
    if (task.hasPhoto && task.photoToken) {
      await ctx.reply(text, {
        format: 'html',
        attachments: withPersistentStart([
          new ImageAttachment({ token: task.photoToken }).toJson(),
          completeTaskMarkup(task.taskId),
        ]) as never,
      });
    } else {
      await sendHtml(ctx, text, [completeTaskMarkup(task.taskId)]);
    }
  });

  bot.action(/^tasks:done:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    const taskId = Number(ctx.match?.[1]);
    const task = await getTask(taskId);
    if (!task) {
      await ack(ctx, 'Задача удалена');
      return;
    }
    if (task.completed) {
      await ack(ctx, 'Уже выполнена');
      await sendHtml(ctx, 'Задача уже была выполнена ранее');
      return;
    }
    await completeTask(taskId, auth.employee.employeeId);
    await ack(ctx, 'Задача выполнена');
    await sendHtml(ctx, `✅ <b>Задача выполнена!</b>\n\n<b>Описание:</b> ${task.description}`);
    await sendMainMenu(ctx, auth.userId);

    const chatId = await findChatIdByTitle(bot.api, config.tasksChatTitle);
    if (chatId) {
      try {
        await bot.api.sendMessageToChat(
          chatId,
          [
            '✅ <b>Задача выполнена!</b>',
            `<b>Дата:</b> ${formatDateRu()}`,
            `<b>Исполнитель:</b> <i>${auth.employee.fullname}</i>`,
            '',
            `<b>Описание:</b> ${task.description}`,
            '',
            `#Выполнено #${task.taskId}`,
          ].join('\n'),
          { format: 'html' },
        );
      } catch (error) {
        console.error('Failed to send completion notice:', error);
      }
    }
  });

  bot.action('admin:employees', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const employees = await getAllEmployees();
    await ack(ctx);
    if (!employees.length) {
      await sendHtml(ctx, 'Список сотрудников пуст');
      return;
    }
    await sendHtml(ctx, 'Список сотрудников', [employeesMarkup(employees)]);
  });

  bot.action(/^emp:show:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const employee = await getEmployee(Number(ctx.match?.[1]));
    if (!employee) return;
    const roles = await getEmployeeRoles(employee.employeeId);
    await ack(ctx);
    await sendHtml(
      ctx,
      [
        `<b>ФИО:</b> ${employee.fullname}`,
        `<b>Должности:</b> ${formatRoles(roles)}`,
        `<b>MAX ID:</b> <code>${employee.userId}</code>`,
        `<b>Профиль:</b> ${prettyUsername(employee.username)}`,
      ].join('\n'),
      [editEmployeeMarkup(employee.employeeId)],
    );
  });

  bot.action(/^emp:del:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const deleted = await deleteEmployee(Number(ctx.match?.[1]));
    await ack(ctx, 'Удалён');
    const employees = await getAllEmployees();
    if (employees.length) await sendHtml(ctx, 'Список сотрудников', [employeesMarkup(employees)]);
    else await sendHtml(ctx, 'Список сотрудников пуст');
    if (deleted) {
      try {
        await bot.api.sendMessageToUser(deleted.userId, 'Администраторы удалили вас из списка сотрудников');
      } catch (error) {
        console.error(error);
      }
    }
  });

  bot.action('emp:list', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    await ack(ctx);
    const employees = await getAllEmployees();
    if (employees.length) await sendHtml(ctx, 'Список сотрудников', [employeesMarkup(employees)]);
    else await sendHtml(ctx, 'Список сотрудников пуст');
  });

  bot.action('emp:close', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await sendHtml(ctx, 'Список скрыт', [adminMenuKeyboard()]);
  });

  bot.action('admin:load_students', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    await ack(ctx, 'Загружаем');
    const ok = await loadStudentsFromExcel();
    await sendHtml(ctx, ok ? 'Данные учеников в базе обновлены' : 'Упс... Загрузить учеников не удалось. Проверьте файл input/inputclass.xlsx');
  });

  bot.action('admin:blacklist', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const blocked = await getBlockedUsers();
    await ack(ctx);
    if (!blocked.length) {
      await sendHtml(ctx, 'Черный список пуст');
      return;
    }
    const user = blocked[0];
    await sendHtml(
      ctx,
      [
        `<b>Пользователь:</b> 1/${blocked.length}`,
        '',
        `<b>ФИО:</b> ${user.fullname ?? '—'}`,
        `<b>Профиль:</b> ${prettyUsername(user.username)}`,
        `<b>MAX ID:</b> <code>${user.userId}</code>`,
      ].join('\n'),
      [blackListMarkup(0, blocked.length)],
    );
  });

  bot.action(/^bl:jump:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const index = Number(ctx.match?.[1]);
    const blocked = await getBlockedUsers();
    if (!blocked.length) {
      await ack(ctx);
      await sendHtml(ctx, 'Черный список пуст');
      return;
    }
    const safeIndex = Math.min(Math.max(index, 0), blocked.length - 1);
    const user = blocked[safeIndex];
    await ack(ctx);
    await sendHtml(
      ctx,
      [
        `<b>Пользователь:</b> ${safeIndex + 1}/${blocked.length}`,
        '',
        `<b>ФИО:</b> ${user.fullname ?? '—'}`,
        `<b>Профиль:</b> ${prettyUsername(user.username)}`,
        `<b>MAX ID:</b> <code>${user.userId}</code>`,
      ].join('\n'),
      [blackListMarkup(safeIndex, blocked.length)],
    );
  });

  bot.action(/^bl:unlock:(\d+)$/, async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth || !classifyRoles(auth.roles).isAdmin) return;
    const index = Number(ctx.match?.[1]);
    const blocked = await getBlockedUsers();
    const user = blocked[index];
    if (user) await unlockUser(user.blockedUserId);
    const remaining = await getBlockedUsers();
    await ack(ctx, 'Разблокирован');
    if (!remaining.length) {
      await sendHtml(ctx, 'Черный список пуст');
      return;
    }
    const nextIndex = Math.min(index, remaining.length - 1);
    const next = remaining[nextIndex];
    await sendHtml(
      ctx,
      [
        `<b>Пользователь:</b> ${nextIndex + 1}/${remaining.length}`,
        '',
        `<b>ФИО:</b> ${next.fullname ?? '—'}`,
        `<b>Профиль:</b> ${prettyUsername(next.username)}`,
        `<b>MAX ID:</b> <code>${next.userId}</code>`,
      ].join('\n'),
      [blackListMarkup(nextIndex, remaining.length)],
    );
  });

  bot.action('bl:close', async (ctx) => {
    const auth = await requireEmployee(ctx);
    if (!auth) return;
    await ack(ctx);
    await sendHtml(ctx, 'Список скрыт', [adminMenuKeyboard()]);
  });

  bot.on('message_created', async (ctx) => {
    const userId = getUserId(ctx);
    if (!userId) return;
    if (await userBlocked(userId)) {
      await sendHtml(ctx, '🙅‍♂️ Администраторы добавили вас в черный список');
      return;
    }

    const text = getMessageText(ctx);
    if (isStartTrigger(ctx, text)) {
      await handleStart(ctx);
      return;
    }
    if (text === MENU_TEXT.register) {
      await startRegistration(ctx);
      return;
    }
    if (text === MENU_TEXT.admin || text === MENU_TEXT.main) {
      if (text === MENU_TEXT.main) {
        await handleStart(ctx);
        return;
      }
      await openAdminMenu(ctx);
      return;
    }
    if (text === MENU_TEXT.absents) {
      await openAbsents(ctx);
      return;
    }
    if (text === MENU_TEXT.tasks) {
      await openTasks(ctx);
      return;
    }
    if (text === MENU_TEXT.violations) {
      await openViolations(ctx);
      return;
    }
    if (text === MENU_TEXT.repair) {
      await openRepair(ctx);
      return;
    }
    const photoToken = getPhotoToken(ctx);
    const session = await getSession(userId);

    if (session.step === 'registration_wait_name') {
      if (!text || text.startsWith('/')) return;
      if (text.split(/\s+/).length < 2) {
        await sendHtml(ctx, 'Введите <b>ФИО</b> через пробел. Например: Иванов Максим Игоревич');
        return;
      }
      await setSession(userId, { fio: text, rolesChosen: [] });
      await sendInteractiveHtml(
        ctx,
        'Выберите Вашу должность (можно несколько).\nПосле выбора нажмите <b>Готово</b>.',
        [rolesMarkup([])],
      );
      return;
    }

    const employee = await getEmployeeByUserId(userId);
    if (!employee) return;

    if (session.step === 'create_task_wait_place' && text && !text.startsWith('/')) {
      session.task = { ...(session.task ?? {}), place: text };
      session.step = undefined;
      await setSession(userId, session);
      await sendTaskPanel(ctx, session.task);
      return;
    }

    if (session.step === 'create_task_wait_description' && text && !text.startsWith('/')) {
      session.task = { ...(session.task ?? {}), description: text };
      session.step = undefined;
      await setSession(userId, session);
      await sendTaskPanel(ctx, session.task);
      return;
    }

    if (session.step === 'create_task_wait_photo' && photoToken) {
      session.task = { ...(session.task ?? {}), photoToken };
      session.step = undefined;
      await setSession(userId, session);
      await sendTaskPanel(ctx, session.task);
      return;
    }

    if (session.step === 'create_violation_wait_description' && text && !text.startsWith('/')) {
      session.violation = { ...(session.violation ?? {}), description: text };
      session.step = undefined;
      await setSession(userId, session);
      await sendViolationPanel(ctx, session.violation);
      return;
    }

    if (session.step === 'create_violation_wait_photo' && photoToken) {
      session.violation = { ...(session.violation ?? {}), photoToken };
      session.step = undefined;
      await setSession(userId, session);
      await sendViolationPanel(ctx, session.violation);
    }
  });
}
