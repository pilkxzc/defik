'use strict';
const session = require('express-session');
const fs      = require('fs');
const { SESSIONS_PATH, SESSION_SECRET } = require('../config');

class FileSessionStore extends session.Store {
    constructor() {
        super();
        this.sessions = {};
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(SESSIONS_PATH)) {
                const data = fs.readFileSync(SESSIONS_PATH, 'utf8');
                this.sessions = JSON.parse(data);
                this.cleanExpired();
            }
        } catch (err) {
            console.log('Creating new sessions file');
            this.sessions = {};
        }
    }

    save() {
        try {
            fs.writeFileSync(SESSIONS_PATH, JSON.stringify(this.sessions, null, 2));
        } catch (err) {
            console.error('Error saving sessions:', err);
        }
    }

    cleanExpired() {
        const now = Date.now();
        let changed = false;
        for (const sid in this.sessions) {
            const sess = this.sessions[sid];
            if (sess.cookie && sess.cookie.expires) {
                const expires = new Date(sess.cookie.expires).getTime();
                if (expires <= now) {
                    delete this.sessions[sid];
                    changed = true;
                }
            }
        }
        if (changed) this.save();
    }

    get(sid, callback) {
        let sess = this.sessions[sid];

        if (!sess && fs.existsSync(SESSIONS_PATH)) {
            try {
                const fileSessions = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8'));
                sess = fileSessions[sid];
                if (sess) {
                    this.sessions[sid] = sess;
                    console.log(`[SessionStore] Session ${sid.substring(0,8)}... loaded from file`);
                }
            } catch(e) {}
        }

        if (sess) {
            if (sess.cookie && sess.cookie.expires) {
                const expires = new Date(sess.cookie.expires).getTime();
                if (expires <= Date.now()) {
                    this.destroy(sid, () => {});
                    return callback(null, null);
                }
            }
            callback(null, sess);
        } else {
            console.log(`[SessionStore] Session ${sid.substring(0,8)}... NOT FOUND`);
            callback(null, null);
        }
    }

    set(sid, sess, callback) {
        this.sessions[sid] = sess;
        this.save();
        callback && callback(null);
    }

    destroy(sid, callback) {
        delete this.sessions[sid];
        this.save();
        callback && callback(null);
    }

    all(callback) {
        callback(null, Object.values(this.sessions));
    }

    length(callback) {
        callback(null, Object.keys(this.sessions).length);
    }

    clear(callback) {
        this.sessions = {};
        this.save();
        callback && callback(null);
    }

    touch(sid, sess, callback) {
        if (this.sessions[sid]) {
            this.sessions[sid].cookie = sess.cookie;
            this.save();
        }
        callback && callback(null);
    }

    // Get all sessions for a specific userId
    getByUserId(userId) {
        const results = [];
        for (const sid in this.sessions) {
            const sess = this.sessions[sid];
            if (sess.userId === userId) {
                // Check expiry
                if (sess.cookie && sess.cookie.expires) {
                    if (new Date(sess.cookie.expires).getTime() <= Date.now()) continue;
                }
                results.push({ sid, ...sess });
            }
        }
        return results;
    }

    // Destroy a specific session by sid (direct access)
    destroyById(sid) {
        if (this.sessions[sid]) {
            delete this.sessions[sid];
            this.save();
            return true;
        }
        return false;
    }
}

const sessionStore = new FileSessionStore();

function createSessionMiddleware() {
    return session({
        store: sessionStore,
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: false,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        }
    });
}

module.exports = { FileSessionStore, createSessionMiddleware, sessionStore };
