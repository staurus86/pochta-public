import { DatabaseSync } from "node:sqlite";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export class ManagerAuth {
    constructor(dbPath, options = {}) {
        this.db = new DatabaseSync(dbPath);
        this.tokenSecret = options.tokenSecret || process.env.AUTH_SECRET || randomBytes(32).toString("hex");

        if (!process.env.AUTH_SECRET && !options.tokenSecret) {
            console.warn("WARNING: AUTH_SECRET not set — tokens will be invalid after server restart");
        }

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'manager',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_login_at TEXT
            )
        `);
    }

    createUser({ login, password, fullName, role = "manager" }) {
        const salt = randomBytes(16).toString("hex");
        const passwordHash = this._hashPassword(password, salt);
        const stmt = this.db.prepare(
            "INSERT INTO users (login, password_hash, salt, full_name, role) VALUES (?, ?, ?, ?, ?)"
        );
        const result = stmt.run(login, passwordHash, salt, fullName, role);
        return { id: Number(result.lastInsertRowid), login, fullName, role };
    }

    authenticate(login, password) {
        const stmt = this.db.prepare("SELECT * FROM users WHERE login = ? AND active = 1");
        const user = stmt.get(login);
        if (!user) return null;
        const hash = this._hashPassword(password, user.salt);
        if (!timingSafeEqual(Buffer.from(hash), Buffer.from(user.password_hash))) return null;
        this.db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
        const token = this._createToken(user);
        return {
            token,
            user: { id: user.id, login: user.login, fullName: user.full_name, role: user.role }
        };
    }

    verifyToken(token) {
        try {
            const [payloadB64, sig] = token.split(".");
            if (!payloadB64 || !sig) return null;
            const expectedSig = createHmac("sha256", this.tokenSecret).update(payloadB64).digest("base64url");
            if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
            const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
            if (Date.now() > payload.exp) return null;
            return { id: payload.sub, login: payload.login, fullName: payload.fullName, role: payload.role };
        } catch {
            return null;
        }
    }

    listUsers() {
        return this.db.prepare("SELECT id, login, full_name, role, active, created_at, last_login_at FROM users").all()
            .map((u) => ({ id: u.id, login: u.login, fullName: u.full_name, role: u.role, active: Boolean(u.active), createdAt: u.created_at, lastLoginAt: u.last_login_at }));
    }

    updateUser(id, updates) {
        const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
        if (!user) return null;
        if (updates.password) {
            const salt = randomBytes(16).toString("hex");
            const hash = this._hashPassword(updates.password, salt);
            this.db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, id);
        }
        if (updates.fullName) this.db.prepare("UPDATE users SET full_name = ? WHERE id = ?").run(updates.fullName, id);
        if (updates.active !== undefined) this.db.prepare("UPDATE users SET active = ? WHERE id = ?").run(updates.active ? 1 : 0, id);
        return this.listUsers().find((u) => u.id === id);
    }

    deleteUser(id) {
        this.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
        return { deleted: true };
    }

    ensureAdmin() {
        const existing = this.db.prepare("SELECT id FROM users WHERE login = 'admin' AND role = 'admin'").get();
        const envPassword = process.env.ADMIN_PASSWORD;
        if (!existing) {
            const password = envPassword || "admin";
            this.createUser({ login: "admin", password, fullName: "Администратор", role: "admin" });
            console.log("Admin user created (password: " + (envPassword ? "[from ADMIN_PASSWORD env]" : "admin") + ")");
        } else if (envPassword) {
            // Always sync password from ADMIN_PASSWORD env on startup
            const salt = this.db.prepare("SELECT salt FROM users WHERE id = ?").get(existing.id).salt;
            const newHash = this._hashPassword(envPassword, salt);
            const currentHash = this.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(existing.id).password_hash;
            if (newHash !== currentHash) {
                this.updateUser(existing.id, { password: envPassword });
                console.log("Admin password updated from ADMIN_PASSWORD env");
            }
        }
    }

    _hashPassword(password, salt) {
        return createHmac("sha256", salt).update(password).digest("hex");
    }

    _createToken(user) {
        const payload = {
            sub: user.id,
            login: user.login,
            fullName: user.full_name,
            role: user.role,
            exp: Date.now() + TOKEN_TTL_MS
        };
        const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
        const sig = createHmac("sha256", this.tokenSecret).update(payloadB64).digest("base64url");
        return `${payloadB64}.${sig}`;
    }
}
