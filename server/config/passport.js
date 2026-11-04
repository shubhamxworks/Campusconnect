const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { createUserRepository } = require('../repositories/user.repository');

function getGoogleOAuthConfig(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId && !clientSecret) {
    return null;
  }
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  return {
    clientId,
    clientSecret,
    callbackURL: env.GOOGLE_CALLBACK_URL || `http://localhost:${Number(env.PORT) || 3000}/api/auth/google/callback`,
  };
}

function configurePassport(passport, pool, config) {
  const users = createUserRepository(pool);

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.clientId,
        clientSecret: config.clientSecret,
        callbackURL: config.callbackURL,
        state: true,
        pkce: 'S256',
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const user = await users.findOrCreateFromGoogle({
            subject: profile.id,
            email: profile.emails?.[0]?.value,
            displayName: profile.displayName,
            emailVerified: profile._json?.email_verified === true,
          });
          done(null, user);
        } catch (error) {
          done(error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      done(null, await users.findById(id));
    } catch (error) {
      done(error);
    }
  });

  return users;
}

module.exports = { configurePassport, getGoogleOAuthConfig };
