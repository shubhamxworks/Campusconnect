const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { rateLimit } = require('express-rate-limit');
const { createDatabasePool } = require('../config/database');
const { configurePassport, getGoogleOAuthConfig } = require('../config/passport');
const { PostgresSessionStore } = require('../storage/postgres-session-store');
const { createUserRepository } = require('../repositories/user.repository');
const { hashPassword, validatePassword, verifyPassword } = require('../utils/password');

const DUMMY_PASSWORD_HASH = `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sessionLifetime = 8 * 60 * 60 * 1000;

function isSameOrigin(request) {
  const origin = request.get('origin');
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === `${request.protocol}://${request.get('host')}`;
  } catch {
    return false;
  }
}

function requireSameOrigin(request, response, next) {
  if (!isSameOrigin(request)) {
    response.status(403).json({ error: 'Request origin could not be verified.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function getPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

function createAuthRouter({ env = process.env, pool: providedPool, userRepository: providedUsers } = {}) {
  const router = express.Router();
  const oauthConfig = getGoogleOAuthConfig(env);
  const hasDatabaseConfig = Boolean(env.SUPABASE_DB_URL || env.DATABASE_URL);
  const hasSessionSecret = typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32;

  if (env.EVENTS_DATA_SOURCE === 'postgres' && hasDatabaseConfig && !hasSessionSecret) {
    throw new Error('SESSION_SECRET must contain at least 32 characters when PostgreSQL authentication is enabled.');
  }
  if (oauthConfig && !hasDatabaseConfig) {
    throw new Error('Google OAuth requires SUPABASE_DB_URL or DATABASE_URL to be configured.');
  }

  const localAuthEnabled = hasDatabaseConfig && hasSessionSecret;
  const googleSignInEnabled = Boolean(oauthConfig);

  router.get('/config', (_request, response) => {
    response.json({ googleSignInEnabled, localAuthEnabled });
  });

  if (!localAuthEnabled && !googleSignInEnabled) {
    const disabledAuthMiddleware = (_request, _response, next) => next();
    const requireAuthenticated = (_request, response) => {
      response.status(503).json({ error: 'Authentication is not configured.' });
    };
    router.get('/google', (_request, response) => {
      response.status(503).json({ error: 'Google sign-in is not configured.' });
    });
    router.get('/google/callback', (_request, response) => {
      response.status(503).json({ error: 'Google sign-in is not configured.' });
    });
    router.get('/me', (_request, response) => {
      response.json({ user: null });
    });
    router.post(['/login', '/register', '/logout'], (_request, response) => {
      response.status(503).json({ error: 'Authentication is not configured.' });
    });
    router.patch('/profile', (_request, response) => {
      response.status(503).json({ error: 'Authentication is not configured.' });
    });
    return {
      router,
      enabled: googleSignInEnabled,
      localAuthEnabled,
      middleware: disabledAuthMiddleware,
      requireAuthenticated,
      requireSameOrigin,
    };
  }

  const pool = providedPool || createDatabasePool(env);
  const store = new PostgresSessionStore(pool);
  const users = providedUsers || createUserRepository(pool);
  const authMiddleware = express.Router();
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again later.' },
  });

  authMiddleware.use(
    session({
      name: 'campusconnect.sid',
      secret: env.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: sessionLifetime,
      },
    }),
  );

  const requireAuthenticated = asyncRoute(async (request, response, next) => {
    const user = request.user ?? (request.session?.userId
      ? await users.findById(request.session.userId)
      : null);
    if (!user) {
      response.status(401).json({
        error: 'Sign in to register for events.',
        signInUrl: '/login.html',
      });
      return;
    }

    request.authUser = user;
    next();
  });

  if (googleSignInEnabled) {
    configurePassport(passport, pool, oauthConfig);
    authMiddleware.use(passport.initialize(), passport.session());
    router.get('/google', passport.authenticate('google', {
      scope: ['openid', 'email', 'profile'],
    }));

    router.get('/google/callback', (request, response, next) => {
      passport.authenticate('google', (error, user) => {
        if (error) {
          next(error);
          return;
        }
        if (!user) {
          response.redirect('/login.html?error=sign_in_failed');
          return;
        }

        request.logIn(user, (loginError) => {
          if (loginError) {
            next(loginError);
            return;
          }
          response.redirect('/events.html?signin=success');
        });
      })(request, response, next);
    });
  } else {
    router.get('/google', (_request, response) => {
      response.status(503).json({ error: 'Google sign-in is not configured.' });
    });
    router.get('/google/callback', (_request, response) => {
      response.status(503).json({ error: 'Google sign-in is not configured.' });
    });
  }

  router.get(
    '/me',
    asyncRoute(async (request, response) => {
      const user = request.user ?? (request.session.userId
        ? await users.findById(request.session.userId)
        : null);
      response.json({ user: user ? getPublicUser(user) : null });
    }),
  );

  router.patch(
    '/profile',
    requireSameOrigin,
    requireAuthenticated,
    asyncRoute(async (request, response) => {
      const displayName = typeof request.body?.displayName === 'string'
        ? request.body.displayName.trim()
        : '';
      if (!displayName || displayName.length > 120) {
        response.status(400).json({ error: 'Display name must be between 1 and 120 characters.' });
        return;
      }

      const user = await users.updateDisplayName(request.authUser.id, displayName);
      if (!user) {
        response.status(404).json({ error: 'Your account could not be found.' });
        return;
      }
      response.json({ user: getPublicUser(user) });
    }),
  );

  router.post(
    '/register',
    requireSameOrigin,
    passwordLimiter,
    asyncRoute(async (request, response, next) => {
      const displayName = typeof request.body?.displayName === 'string'
        ? request.body.displayName.trim()
        : '';
      const email = typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      const password = request.body?.password;

      if (!displayName || displayName.length > 120 || !EMAIL_PATTERN.test(email) || email.length > 254) {
        response.status(400).json({ error: 'Enter a name and a valid email address.' });
        return;
      }
      if (!validatePassword(password)) {
        response.status(400).json({ error: 'Password must be between 12 and 128 characters.' });
        return;
      }

      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await users.createLocalUser({ email, displayName, passwordHash });
      } catch (error) {
        if (error.code === '23505') {
          response.status(409).json({ error: 'An account with that email already exists. Try signing in instead.' });
          return;
        }
        next(error);
        return;
      }

      request.session.regenerate((sessionError) => {
        if (sessionError) {
          next(sessionError);
          return;
        }
        request.session.userId = user.id;
        request.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          response.status(201).json({ user: getPublicUser(user) });
        });
      });
    }),
  );

  router.post(
    '/login',
    requireSameOrigin,
    passwordLimiter,
    asyncRoute(async (request, response, next) => {
      const email = typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase()
        : '';
      const password = typeof request.body?.password === 'string'
        ? request.body.password
        : '';
      const validEmail = email.length <= 254 && EMAIL_PATTERN.test(email);
      const user = validEmail ? await users.findByEmailForLogin(email) : null;
      const passwordMatches = await verifyPassword(
        password,
        user?.passwordHash || DUMMY_PASSWORD_HASH,
      );

      if (!user || !user.passwordHash || !passwordMatches) {
        response.status(401).json({ error: 'Email or password is incorrect.' });
        return;
      }

      request.session.regenerate((sessionError) => {
        if (sessionError) {
          next(sessionError);
          return;
        }
        request.session.userId = user.id;
        request.session.save((saveError) => {
          if (saveError) {
            next(saveError);
            return;
          }
          response.json({ user: getPublicUser(user) });
        });
      });
    }),
  );

  router.post('/logout', requireSameOrigin, (request, response, next) => {
    if (!request.session) {
      response.sendStatus(204);
      return;
    }

    request.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }

      response.clearCookie('campusconnect.sid', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      response.sendStatus(204);
    });
  });

  return {
    router,
    enabled: googleSignInEnabled,
    localAuthEnabled,
    middleware: authMiddleware,
    requireAuthenticated,
    requireSameOrigin,
    pool,
    store,
  };
}

module.exports = { createAuthRouter, isSameOrigin };
