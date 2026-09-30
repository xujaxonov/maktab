// Yangi maktab va uning adminini yaratish (superadmin paneli 4-bosqichda bo'ladi, S-1).
// Ishlatish: npm run create-school -- "12-maktab" "Karimova Dilnoza" admin12
import { openDb, tx, audit } from '../db.js';
import { hashPassword, generatePassword } from '../auth.js';

const [schoolName, adminName, adminLogin] = process.argv.slice(2);
if (!schoolName || !adminName || !adminLogin) {
  console.log('Ishlatish: npm run create-school -- "<maktab nomi>" "<admin ism-familiyasi>" <admin login>');
  process.exit(1);
}

const db = openDb();
const login = adminLogin.trim().toLowerCase();
if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) {
  console.error(`"${login}" logini band. Boshqa login tanlang.`);
  process.exit(1);
}

const password = generatePassword();
const schoolId = tx(db, () => {
  const school = db.prepare('INSERT INTO schools (name) VALUES (?)').run(schoolName.trim());
  const user = db
    .prepare("INSERT INTO users (school_id, role, full_name, login, password_hash) VALUES (?, 'admin', ?, ?, ?)")
    .run(school.lastInsertRowid, adminName.trim(), login, hashPassword(password));
  audit(db, { schoolId: school.lastInsertRowid, action: 'school.create', entity: 'school', entityId: school.lastInsertRowid, newValue: { admin_user_id: user.lastInsertRowid } });
  return school.lastInsertRowid;
});

console.log(`Maktab yaratildi (id ${schoolId}): ${schoolName}`);
console.log(`Admin logini: ${login}`);
console.log(`Vaqtinchalik parol: ${password}  (birinchi kirishda almashtiriladi)`);
