export const ADMIN_ROLES = [1, 2];
export const TEACHER_ROLES = [3, 4, 5, 6, 7];
export const TECHNICIAN_ROLES = [8, 9, 10, 11, 12, 13];
/** Директор, заместители, учителя, воспитатели */
export const VIOLATION_ROLES = [1, 2, 3, 5];

export const VIOLATION_FORMS = [
  { formId: 'discipline' as const, title: 'Дисциплина' },
  { formId: 'study' as const, title: 'Учёба' },
];

export type ViolationFormId = (typeof VIOLATION_FORMS)[number]['formId'];

export const ROLES = [
  { roleId: 1, title: 'Директор', description: 'Директор лицея' },
  { roleId: 2, title: 'Заместитель директора', description: 'Заместитель директора' },
  { roleId: 3, title: 'Учитель', description: 'Учитель' },
  { roleId: 4, title: 'Заведующий библиотекой', description: 'Заведующий библиотекой' },
  { roleId: 5, title: 'Воспитатель', description: 'Воспитатель' },
  { roleId: 6, title: 'Классный руководитель', description: 'Классный руководитель' },
  { roleId: 7, title: 'Педагог-психолог', description: 'Педагог-психолог' },
  { roleId: 8, title: 'Сис. админ', description: 'Системный администратор' },
  { roleId: 9, title: 'Инженер', description: 'Инженер' },
  { roleId: 10, title: 'Сантехник', description: 'Сантехник' },
  { roleId: 11, title: 'Электрик', description: 'Электрик' },
  { roleId: 12, title: 'Уборщик', description: 'Уборщик(-ца)' },
  { roleId: 13, title: 'Кастелянша', description: 'Кастелянша' },
] as const;

export const BUILDING_BLOCKS = [
  { blockId: 1, blockName: 'А' },
  { blockId: 2, blockName: 'Б' },
  { blockId: 3, blockName: 'В' },
] as const;

export const ABSENCE_REASONS = [
  { reasonId: 1, title: 'ОРЗ, ОРВИ, ГРИПП', description: 'ОРЗ, ОРВИ, грипп и аналогичные болезни', inLyceum: false },
  { reasonId: 2, title: 'Болеет в Лицее', description: 'До приезда родителей или в изоляторе', inLyceum: true },
  { reasonId: 3, title: 'По заявлению', description: 'По заявлению или уважительной причине', inLyceum: false },
  { reasonId: 4, title: 'Олимпиада и другие мероприятия', description: 'Олимпиады, конференции, соревнования и другие мероприятия вне лицея', inLyceum: false },
  { reasonId: 5, title: 'Олимпиада в Лицее', description: 'Участие в олимпиадах, конкурсах и т.д. но находится в Лицее', inLyceum: true },
  { reasonId: 6, title: 'УТС', description: 'Уехал на сборы', inLyceum: false },
  { reasonId: 7, title: 'УТС в Лицее', description: 'В Лицее на сборах или подготовке', inLyceum: true },
  { reasonId: 8, title: 'Другое', description: 'Причина не известна', inLyceum: false },
] as const;

export const VALID_CLASSES = [
  '7А', '7Б', '8А', '8Б', '9А', '9Б', '10А', '10Б', '11А', '11Б',
] as const;

export const CLASS_PREFIX: Record<string, string> = {
  '7А': 'a_7',
  '7Б': 'b_7',
  '8А': 'a_8',
  '8Б': 'b_8',
  '9А': 'a_9',
  '9Б': 'b_9',
  '10А': 'a_10',
  '10Б': 'b_10',
  '11А': 'a_11',
  '11Б': 'b_11',
};

export type RoleId = (typeof ROLES)[number]['roleId'];

export function getRole(roleId: number) {
  return ROLES.find((role) => role.roleId === roleId);
}

export function getBlock(blockId: number) {
  return BUILDING_BLOCKS.find((block) => block.blockId === blockId);
}

export function getReason(reasonId: number) {
  return ABSENCE_REASONS.find((reason) => reason.reasonId === reasonId);
}

export function formatRoles(roleIds: number[]): string {
  return roleIds.map((id) => getRole(id)?.title ?? String(id)).join(', ');
}
