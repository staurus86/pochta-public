import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { ManagerAuth } from "../src/services/manager-auth.js";

describe("ManagerAuth", () => {
    let auth;

    before(() => {
        auth = new ManagerAuth(":memory:", { tokenSecret: "test-secret-key" });
    });

    test("createUser creates a manager with hashed password", () => {
        const user = auth.createUser({ login: "ivanov", password: "test123", fullName: "Иван Иванов", role: "manager" });
        assert.ok(user.id);
        assert.strictEqual(user.login, "ivanov");
        assert.strictEqual(user.role, "manager");
        assert.ok(!user.passwordHash);
    });

    test("authenticate returns token for valid credentials", () => {
        const result = auth.authenticate("ivanov", "test123");
        assert.ok(result);
        assert.ok(result.token);
        assert.strictEqual(result.user.login, "ivanov");
    });

    test("authenticate returns null for invalid password", () => {
        const result = auth.authenticate("ivanov", "wrong");
        assert.strictEqual(result, null);
    });

    test("authenticate returns null for nonexistent user", () => {
        const result = auth.authenticate("nobody", "test");
        assert.strictEqual(result, null);
    });

    test("verifyToken returns user for valid token", () => {
        const { token } = auth.authenticate("ivanov", "test123");
        const user = auth.verifyToken(token);
        assert.ok(user);
        assert.strictEqual(user.login, "ivanov");
        assert.strictEqual(user.role, "manager");
    });

    test("verifyToken returns null for invalid token", () => {
        assert.strictEqual(auth.verifyToken("invalid-token"), null);
    });

    test("verifyToken returns null for tampered token", () => {
        const { token } = auth.authenticate("ivanov", "test123");
        const tampered = token.slice(0, -5) + "XXXXX";
        assert.strictEqual(auth.verifyToken(tampered), null);
    });

    test("listUsers returns all users without password hashes", () => {
        const users = auth.listUsers();
        assert.ok(users.length >= 1);
        assert.ok(!users[0].passwordHash);
        assert.ok(!users[0].password_hash);
        assert.ok(!users[0].salt);
    });

    test("duplicate login throws", () => {
        assert.throws(() => auth.createUser({ login: "ivanov", password: "x", fullName: "X", role: "manager" }));
    });

    test("updateUser changes fullName", () => {
        const users = auth.listUsers();
        const user = users.find((u) => u.login === "ivanov");
        const updated = auth.updateUser(user.id, { fullName: "Иван Петрович" });
        assert.strictEqual(updated.fullName, "Иван Петрович");
    });

    test("updateUser changes password", () => {
        const users = auth.listUsers();
        const user = users.find((u) => u.login === "ivanov");
        auth.updateUser(user.id, { password: "newpass" });
        assert.strictEqual(auth.authenticate("ivanov", "test123"), null);
        assert.ok(auth.authenticate("ivanov", "newpass"));
    });

    test("deleteUser deactivates user", () => {
        auth.createUser({ login: "todelete", password: "x", fullName: "Del", role: "manager" });
        const user = auth.listUsers().find((u) => u.login === "todelete");
        auth.deleteUser(user.id);
        assert.strictEqual(auth.authenticate("todelete", "x"), null);
    });

    test("ensureAdmin creates admin if none exists", () => {
        const auth2 = new ManagerAuth(":memory:", { tokenSecret: "test" });
        auth2.ensureAdmin();
        const users = auth2.listUsers();
        assert.ok(users.some((u) => u.role === "admin" && u.login === "admin"));
    });

    test("ensureAdmin does not create duplicate admin", () => {
        const auth2 = new ManagerAuth(":memory:", { tokenSecret: "test" });
        auth2.ensureAdmin();
        auth2.ensureAdmin();
        const admins = auth2.listUsers().filter((u) => u.role === "admin");
        assert.strictEqual(admins.length, 1);
    });
});
