import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ADMIN_ROLES, TEACHER_ROLES, TECHNICIAN_ROLES, VIOLATION_ROLES } from './catalog.js';
import { config } from './config.js';

export interface Employee {
  employeeId: number;
  userId: number;
  fullname: string;
  username?: string | null;
}

export interface RegistrationRequest {
  requestId: number;
  userId: number;
  fromName: string;
  fromUsername?: string | null;
  roles: number[];
  status: 'pending' | 'closed';
}

export interface ClassRecord {
  classId: number;
  className: string;
  lastDate?: string | null;
}

export interface Student {
  studentId: number;
  surname: string;
  name: string;
  middlename?: string | null;
  classId: number;
}

export interface BlockedUser {
  blockedUserId: number;
  userId: number;
  fullname?: string | null;
  username?: string | null;
}

export interface Absent {
  absentId: number;
  reasonId: number;
  studentId: number;
  date: string;
}

export interface TaskRecord {
  taskId: number;
  createdDate: string;
  createdBy: number;
  description: string;
  buildingBlock: number;
  technicianRole: number;
  place: string;
  hasPhoto: boolean;
  photoToken?: string | null;
  completed: boolean;
  completedDate?: string | null;
  completedBy?: number | null;
}

export interface AbsentDraft {
  studentId: number;
  reasonId: number;
}

export interface TaskDraft {
  blockId?: number;
  place?: string;
  description?: string;
  technicianRoleId?: number;
  photoToken?: string;
}

export interface ViolationDraft {
  classId?: number;
  studentId?: number;
  formId?: 'discipline' | 'study';
  description?: string;
  photoToken?: string;
}

export type SessionStep =
  | 'registration_wait_name'
  | 'create_task_wait_place'
  | 'create_task_wait_description'
  | 'create_task_wait_photo'
  | 'create_violation_wait_description'
  | 'create_violation_wait_photo';

export interface Session {
  step?: SessionStep;
  fio?: string;
  rolesChosen?: number[];
  classId?: number;
  studentId?: number;
  absents?: AbsentDraft[];
  task?: TaskDraft;
  violation?: ViolationDraft;
  blacklistIndex?: number;
}

mkdirSync(config.dataDir, { recursive: true });
const dbFile = path.join(config.dataDir, 'innobot.sqlite');
const db = new Database(dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  employee_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  fullname TEXT NOT NULL,
  username TEXT
);
CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (employee_id, role_id),
  FOREIGN KEY (employee_id) REFERENCES employees(employee_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS requests (
  request_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_name TEXT NOT NULL,
  from_username TEXT,
  roles_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'closed'))
);
CREATE TABLE IF NOT EXISTS classes (
  class_id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL UNIQUE,
  last_date TEXT
);
CREATE TABLE IF NOT EXISTS students (
  student_id INTEGER PRIMARY KEY AUTOINCREMENT,
  surname TEXT NOT NULL,
  name TEXT NOT NULL,
  middlename TEXT,
  class_id INTEGER NOT NULL,
  FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS blocked (
  blocked_user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  fullname TEXT,
  username TEXT
);
CREATE TABLE IF NOT EXISTS absents (
  absent_id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tasks (
  task_id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_date TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  description TEXT NOT NULL,
  building_block INTEGER NOT NULL,
  technician_role INTEGER NOT NULL,
  place TEXT NOT NULL,
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_token TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_date TEXT,
  completed_by INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL
);
`);

function mapEmployee(row: {
  employee_id: number;
  user_id: number;
  fullname: string;
  username: string | null;
}): Employee {
  return {
    employeeId: row.employee_id,
    userId: row.user_id,
    fullname: row.fullname,
    username: row.username,
  };
}

export function todayIso(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateRu(iso = todayIso()): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export async function getSession(userId: number): Promise<Session> {
  const row = db.prepare('SELECT payload_json FROM sessions WHERE user_id = ?').get(userId) as
    | { payload_json: string }
    | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.payload_json) as Session;
  } catch {
    return {};
  }
}

export async function setSession(userId: number, session: Session): Promise<void> {
  db.prepare(
    `INSERT INTO sessions (user_id, payload_json) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET payload_json = excluded.payload_json`,
  ).run(userId, JSON.stringify(session));
}

export async function clearSession(userId: number): Promise<void> {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function getEmployeeByUserId(userId: number): Promise<Employee | undefined> {
  const row = db.prepare('SELECT * FROM employees WHERE user_id = ?').get(userId) as
    | {
        employee_id: number;
        user_id: number;
        fullname: string;
        username: string | null;
      }
    | undefined;
  return row ? mapEmployee(row) : undefined;
}

export async function getEmployee(employeeId: number): Promise<Employee | undefined> {
  const row = db.prepare('SELECT * FROM employees WHERE employee_id = ?').get(employeeId) as
    | {
        employee_id: number;
        user_id: number;
        fullname: string;
        username: string | null;
      }
    | undefined;
  return row ? mapEmployee(row) : undefined;
}

export async function getAllEmployees(): Promise<Employee[]> {
  const rows = db.prepare('SELECT * FROM employees ORDER BY fullname COLLATE NOCASE').all() as Array<{
    employee_id: number;
    user_id: number;
    fullname: string;
    username: string | null;
  }>;
  return rows.map(mapEmployee);
}

/** Поиск сотрудников по фрагментам ФИО (все слова должны встретиться) */
export async function findEmployeesByNameParts(nameQuery: string): Promise<Employee[]> {
  const parts = nameQuery
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return [];
  const employees = await getAllEmployees();
  return employees.filter((employee) => {
    const full = employee.fullname.toLowerCase();
    return parts.every((part) => full.includes(part));
  });
}

export async function addEmployee(userId: number, fullname: string, username?: string | null): Promise<Employee> {
  const result = db
    .prepare('INSERT INTO employees (user_id, fullname, username) VALUES (?, ?, ?)')
    .run(userId, fullname, username ?? null);
  return {
    employeeId: Number(result.lastInsertRowid),
    userId,
    fullname,
    username,
  };
}

export async function deleteEmployee(employeeId: number): Promise<Employee | undefined> {
  const employee = await getEmployee(employeeId);
  if (!employee) return undefined;
  db.prepare('DELETE FROM employees WHERE employee_id = ?').run(employeeId);
  return employee;
}

export async function setEmployeeRole(employeeId: number, roleId: number): Promise<void> {
  db.prepare(
    'INSERT OR IGNORE INTO employee_roles (employee_id, role_id) VALUES (?, ?)',
  ).run(employeeId, roleId);
}

export async function getEmployeeRoles(employeeId: number): Promise<number[]> {
  const rows = db
    .prepare('SELECT role_id FROM employee_roles WHERE employee_id = ?')
    .all(employeeId) as Array<{ role_id: number }>;
  return rows.map((row) => row.role_id);
}

export async function getEmployeesByRole(roleId: number): Promise<number[]> {
  const rows = db
    .prepare('SELECT DISTINCT employee_id FROM employee_roles WHERE role_id = ?')
    .all(roleId) as Array<{ employee_id: number }>;
  return rows.map((row) => row.employee_id);
}

export async function getAdmins(): Promise<number[]> {
  const placeholders = ADMIN_ROLES.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT DISTINCT employee_id FROM employee_roles WHERE role_id IN (${placeholders})`,
    )
    .all(...ADMIN_ROLES) as Array<{ employee_id: number }>;
  return rows.map((row) => row.employee_id);
}

export async function getTeachers(): Promise<number[]> {
  const placeholders = TEACHER_ROLES.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT DISTINCT employee_id FROM employee_roles WHERE role_id IN (${placeholders})`,
    )
    .all(...TEACHER_ROLES) as Array<{ employee_id: number }>;
  return rows.map((row) => row.employee_id);
}

export function classifyRoles(roleIds: number[]) {
  const isAdmin = roleIds.some((id) => (ADMIN_ROLES as number[]).includes(id));
  const isTeacher = roleIds.some((id) => (TEACHER_ROLES as number[]).includes(id));
  const isTechnician = roleIds.some((id) => (TECHNICIAN_ROLES as number[]).includes(id));
  const canMarkViolations = roleIds.some((id) => (VIOLATION_ROLES as number[]).includes(id));
  return {
    isAdmin,
    isTeacher,
    isTechnician,
    canMarkAbsents: isAdmin || isTeacher,
    canMarkViolations,
  };
}

export async function getPendingRequestByUserId(userId: number): Promise<RegistrationRequest | undefined> {
  const row = db
    .prepare(`SELECT * FROM requests WHERE user_id = ? AND status = 'pending' ORDER BY request_id DESC LIMIT 1`)
    .get(userId) as
    | {
        request_id: number;
        user_id: number;
        from_name: string;
        from_username: string | null;
        roles_json: string;
        status: 'pending' | 'closed';
      }
    | undefined;
  if (!row) return undefined;
  return {
    requestId: row.request_id,
    userId: row.user_id,
    fromName: row.from_name,
    fromUsername: row.from_username,
    roles: JSON.parse(row.roles_json) as number[],
    status: row.status,
  };
}

export async function getRequest(requestId: number): Promise<RegistrationRequest | undefined> {
  const row = db.prepare('SELECT * FROM requests WHERE request_id = ?').get(requestId) as
    | {
        request_id: number;
        user_id: number;
        from_name: string;
        from_username: string | null;
        roles_json: string;
        status: 'pending' | 'closed';
      }
    | undefined;
  if (!row) return undefined;
  return {
    requestId: row.request_id,
    userId: row.user_id,
    fromName: row.from_name,
    fromUsername: row.from_username,
    roles: JSON.parse(row.roles_json) as number[],
    status: row.status,
  };
}

export async function addRegistrationRequest(
  userId: number,
  fromName: string,
  fromUsername: string | null | undefined,
  roles: number[],
): Promise<RegistrationRequest> {
  const result = db
    .prepare(
      `INSERT INTO requests (user_id, from_name, from_username, roles_json, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .run(userId, fromName, fromUsername ?? null, JSON.stringify(roles));
  return {
    requestId: Number(result.lastInsertRowid),
    userId,
    fromName,
    fromUsername,
    roles,
    status: 'pending',
  };
}

export async function closeRegistrationRequest(requestId: number): Promise<void> {
  db.prepare(`UPDATE requests SET status = 'closed' WHERE request_id = ?`).run(requestId);
}

export async function userBlocked(userId: number): Promise<boolean> {
  const row = db.prepare('SELECT 1 FROM blocked WHERE user_id = ?').get(userId);
  return Boolean(row);
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const rows = db.prepare('SELECT * FROM blocked ORDER BY blocked_user_id').all() as Array<{
    blocked_user_id: number;
    user_id: number;
    fullname: string | null;
    username: string | null;
  }>;
  return rows.map((row) => ({
    blockedUserId: row.blocked_user_id,
    userId: row.user_id,
    fullname: row.fullname,
    username: row.username,
  }));
}

export async function blockUser(userId: number, fullname?: string | null, username?: string | null): Promise<void> {
  db.prepare(
    `INSERT INTO blocked (user_id, fullname, username) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET fullname = excluded.fullname, username = excluded.username`,
  ).run(userId, fullname ?? null, username ?? null);
}

export async function unlockUser(blockedUserId: number): Promise<void> {
  db.prepare('DELETE FROM blocked WHERE blocked_user_id = ?').run(blockedUserId);
}

export async function getAllClasses(): Promise<ClassRecord[]> {
  const rows = db.prepare('SELECT * FROM classes ORDER BY class_name').all() as Array<{
    class_id: number;
    class_name: string;
    last_date: string | null;
  }>;
  return rows.map((row) => ({
    classId: row.class_id,
    className: row.class_name,
    lastDate: row.last_date,
  }));
}

export async function getClass(classId: number): Promise<ClassRecord | undefined> {
  const row = db.prepare('SELECT * FROM classes WHERE class_id = ?').get(classId) as
    | { class_id: number; class_name: string; last_date: string | null }
    | undefined;
  if (!row) return undefined;
  return { classId: row.class_id, className: row.class_name, lastDate: row.last_date };
}

export async function addClass(className: string): Promise<number> {
  const existing = db.prepare('SELECT class_id FROM classes WHERE class_name = ?').get(className) as
    | { class_id: number }
    | undefined;
  if (existing) return existing.class_id;
  const result = db.prepare('INSERT INTO classes (class_name, last_date) VALUES (?, NULL)').run(className);
  return Number(result.lastInsertRowid);
}

export async function notMarkedClasses(date = todayIso()): Promise<ClassRecord[]> {
  const rows = db
    .prepare('SELECT * FROM classes WHERE last_date IS NULL OR last_date != ?')
    .all(date) as Array<{ class_id: number; class_name: string; last_date: string | null }>;
  return rows.map((row) => ({
    classId: row.class_id,
    className: row.class_name,
    lastDate: row.last_date,
  }));
}

export async function markedClasses(date = todayIso()): Promise<ClassRecord[]> {
  const rows = db.prepare('SELECT * FROM classes WHERE last_date = ?').all(date) as Array<{
    class_id: number;
    class_name: string;
    last_date: string | null;
  }>;
  return rows.map((row) => ({
    classId: row.class_id,
    className: row.class_name,
    lastDate: row.last_date,
  }));
}

export async function setClassLastDate(classId: number, date = todayIso()): Promise<void> {
  db.prepare('UPDATE classes SET last_date = ? WHERE class_id = ?').run(date, classId);
}

export async function replaceStudents(students: Array<Omit<Student, 'studentId'>>): Promise<void> {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM absents').run();
    db.prepare('DELETE FROM students').run();
    const insert = db.prepare(
      'INSERT INTO students (surname, name, middlename, class_id) VALUES (?, ?, ?, ?)',
    );
    for (const student of students) {
      insert.run(student.surname, student.name, student.middlename ?? null, student.classId);
    }
  });
  tx();
}

export async function getStudentsByClass(classId: number): Promise<Student[]> {
  const rows = db
    .prepare(
      `SELECT * FROM students WHERE class_id = ?
       ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE`,
    )
    .all(classId) as Array<{
    student_id: number;
    surname: string;
    name: string;
    middlename: string | null;
    class_id: number;
  }>;
  return rows.map((row) => ({
    studentId: row.student_id,
    surname: row.surname,
    name: row.name,
    middlename: row.middlename,
    classId: row.class_id,
  }));
}

export async function countStudentsByClass(classId: number): Promise<number> {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM students WHERE class_id = ?').get(classId) as {
    cnt: number;
  };
  return row.cnt;
}

export async function getStudent(studentId: number): Promise<Student | undefined> {
  const row = db.prepare('SELECT * FROM students WHERE student_id = ?').get(studentId) as
    | {
        student_id: number;
        surname: string;
        name: string;
        middlename: string | null;
        class_id: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    studentId: row.student_id,
    surname: row.surname,
    name: row.name,
    middlename: row.middlename,
    classId: row.class_id,
  };
}

export async function countAllStudents(): Promise<number> {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM students').get() as { cnt: number };
  return row.cnt;
}

export async function addAbsent(reasonId: number, studentId: number, date = todayIso()): Promise<void> {
  db.prepare('INSERT INTO absents (reason_id, student_id, date) VALUES (?, ?, ?)').run(
    reasonId,
    studentId,
    date,
  );
}

export async function absentsInClass(classId: number, date = todayIso()): Promise<Absent[]> {
  const rows = db
    .prepare(
      `SELECT a.* FROM absents a
       INNER JOIN students s ON s.student_id = a.student_id
       WHERE s.class_id = ? AND a.date = ?`,
    )
    .all(classId, date) as Array<{
    absent_id: number;
    reason_id: number;
    student_id: number;
    date: string;
  }>;
  return rows.map((row) => ({
    absentId: row.absent_id,
    reasonId: row.reason_id,
    studentId: row.student_id,
    date: row.date,
  }));
}

export async function cleanAbsents(): Promise<void> {
  db.prepare('DELETE FROM absents').run();
  db.prepare('UPDATE classes SET last_date = NULL').run();
}

export async function addTask(task: Omit<TaskRecord, 'taskId' | 'completed'>): Promise<TaskRecord> {
  const result = db
    .prepare(
      `INSERT INTO tasks (
        created_date, created_by, description, building_block, technician_role,
        place, has_photo, photo_token, completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      task.createdDate,
      task.createdBy,
      task.description,
      task.buildingBlock,
      task.technicianRole,
      task.place,
      task.hasPhoto ? 1 : 0,
      task.photoToken ?? null,
    );
  return {
    ...task,
    taskId: Number(result.lastInsertRowid),
    completed: false,
  };
}

export async function getTask(taskId: number): Promise<TaskRecord | undefined> {
  const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as
    | {
        task_id: number;
        created_date: string;
        created_by: number;
        description: string;
        building_block: number;
        technician_role: number;
        place: string;
        has_photo: number;
        photo_token: string | null;
        completed: number;
        completed_date: string | null;
        completed_by: number | null;
      }
    | undefined;
  if (!row) return undefined;
  return {
    taskId: row.task_id,
    createdDate: row.created_date,
    createdBy: row.created_by,
    description: row.description,
    buildingBlock: row.building_block,
    technicianRole: row.technician_role,
    place: row.place,
    hasPhoto: Boolean(row.has_photo),
    photoToken: row.photo_token,
    completed: Boolean(row.completed),
    completedDate: row.completed_date,
    completedBy: row.completed_by,
  };
}

export async function getTasksByRoles(roles: number[], completed = false): Promise<TaskRecord[]> {
  if (!roles.length) return [];
  const placeholders = roles.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE technician_role IN (${placeholders}) AND completed = ?
       ORDER BY task_id DESC`,
    )
    .all(...roles, completed ? 1 : 0) as Array<{
    task_id: number;
    created_date: string;
    created_by: number;
    description: string;
    building_block: number;
    technician_role: number;
    place: string;
    has_photo: number;
    photo_token: string | null;
    completed: number;
    completed_date: string | null;
    completed_by: number | null;
  }>;
  return rows.map((row) => ({
    taskId: row.task_id,
    createdDate: row.created_date,
    createdBy: row.created_by,
    description: row.description,
    buildingBlock: row.building_block,
    technicianRole: row.technician_role,
    place: row.place,
    hasPhoto: Boolean(row.has_photo),
    photoToken: row.photo_token,
    completed: Boolean(row.completed),
    completedDate: row.completed_date,
    completedBy: row.completed_by,
  }));
}

export async function completeTask(taskId: number, completedBy: number, date = todayIso()): Promise<void> {
  db.prepare(
    `UPDATE tasks SET completed = 1, completed_date = ?, completed_by = ? WHERE task_id = ?`,
  ).run(date, completedBy, taskId);
}

export async function ensureSuperAdmins(): Promise<void> {
  for (const userId of config.adminIds) {
    let employee = await getEmployeeByUserId(userId);
    if (!employee) {
      employee = await addEmployee(userId, 'Администратор', null);
    }
    const roles = await getEmployeeRoles(employee.employeeId);
    if (!roles.includes(1)) {
      await setEmployeeRole(employee.employeeId, 1);
    }
  }
}

export async function resetDatabase(): Promise<void> {
  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM absents;
      DELETE FROM tasks;
      DELETE FROM blocked;
      DELETE FROM requests;
      DELETE FROM employee_roles;
      DELETE FROM employees;
      DELETE FROM students;
      DELETE FROM classes;
    `);
  });
  tx();
  console.log('Database reset: SQLite counters and records cleared');
}

export async function resetAttendanceForRetest(): Promise<void> {
  await cleanAbsents();
  console.log('Attendance counters cleared for retest');
}
